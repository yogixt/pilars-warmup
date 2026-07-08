import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface WarmupMessage {
  uid: number;
  folder: string;
  inJunk: boolean;
  messageId: string; // RFC Message-ID incl. <>
  from: string; // bare address, lowercased
  subject: string;
  references: string[]; // ordered, oldest-first
  inReplyTo: string | null;
  text: string;
}

/** Open a connection, run `fn`, and always close. */
export async function withImap<T>(
  cfg: ImapConfig,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Fail fast so one slow mailbox can't blow the serverless time budget.
    greetingTimeout: 8000,
    socketTimeout: 15000,
    connectionTimeout: 8000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Resolve the provider's Junk/Spam folder path (\\Junk special-use), if any. */
export async function resolveJunkPath(client: ImapFlow): Promise<string | null> {
  try {
    const list = await client.list();
    const byUse = list.find((m: any) => m.specialUse === "\\Junk");
    if (byUse) return byUse.path;
    const byName = list.find((m: any) => /^(spam|junk)$/i.test(m.path));
    return byName ? byName.path : null;
  } catch {
    return null;
  }
}

function normalizeRefs(refs: unknown): string[] {
  if (!refs) return [];
  if (Array.isArray(refs)) return refs.map(String);
  return String(refs).split(/\s+/).filter(Boolean);
}

/**
 * Fetch recent UNSEEN messages in `folder` that are genuine warm-up traffic:
 * From is one of our pool addresses AND the X-Warmup-Token header matches.
 * This is the safety gate that keeps us away from real business mail.
 */
export async function fetchWarmup(
  client: ImapFlow,
  folder: string,
  opts: { token: string; pool: Set<string>; sinceDays: number }
): Promise<WarmupMessage[]> {
  const lock = await client.getMailboxLock(folder);
  const out: WarmupMessage[] = [];
  try {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
    const uids = (await client.search({ seen: false, since }, { uid: true })) || [];
    if (uids.length === 0) return out;

    for await (const msg of client.fetch(
      uids as number[],
      { uid: true, source: true },
      { uid: true }
    )) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source as Buffer);

      const token = (parsed.headers.get("x-warmup-token") as string | undefined) || "";
      const from = (parsed.from?.value?.[0]?.address || "").toLowerCase();
      if (token !== opts.token) continue; // not our traffic
      if (!opts.pool.has(from)) continue; // sender not in pool -> ignore

      out.push({
        uid: msg.uid,
        folder,
        inJunk: false, // set by caller when folder is the junk path
        messageId: parsed.messageId || `<${msg.uid}@warmup.local>`,
        from,
        subject: parsed.subject || "",
        references: normalizeRefs((parsed as any).references),
        inReplyTo: (parsed.inReplyTo as string | undefined) || null,
        text: parsed.text || "",
      });
    }
  } finally {
    lock.release();
  }
  return out;
}

export interface Bounce {
  uid: number;
  failed: string[]; // permanently-failed recipient addresses (lowercased)
}

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (subsystem|system))/i;
const BOUNCE_SUBJECT =
  /(delivery status notification.*fail|undeliver|returned to sender|failure notice|mail delivery failed|delivery has failed|could not be delivered)/i;

/**
 * Scan a folder for hard-bounce NDRs and extract the permanently-failed
 * recipient addresses (5.x.x status). Marks scanned bounces as seen.
 */
export async function fetchBounces(
  client: ImapFlow,
  folder: string,
  sinceDays: number
): Promise<Bounce[]> {
  const lock = await client.getMailboxLock(folder);
  const out: Bounce[] = [];
  try {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const uids = (await client.search({ seen: false, since }, { uid: true })) || [];
    if (uids.length === 0) return out;

    for await (const msg of client.fetch(uids as number[], { uid: true, source: true }, { uid: true })) {
      if (!msg.source) continue;
      const raw = (msg.source as Buffer).toString("utf8");
      const parsed = await simpleParser(msg.source as Buffer);
      const from = (parsed.from?.value?.[0]?.address || "").toLowerCase();
      const fromName = parsed.from?.text || "";
      const subject = parsed.subject || "";
      const isReport = /multipart\/report/i.test(raw) || /message\/delivery-status/i.test(raw);
      const looksBounce =
        BOUNCE_FROM.test(from) || BOUNCE_FROM.test(fromName) || BOUNCE_SUBJECT.test(subject) || isReport;
      if (!looksBounce) continue;

      // Only act on PERMANENT (5.x.x / 55x) failures, never temporary (4.x.x).
      const permanent = /\b5\.\d\.\d\b/.test(raw) || /\b55\d\b/.test(raw);
      if (!permanent) continue;

      const failed = new Set<string>();
      // 1) DSN "Final-Recipient: rfc822; addr"
      for (const m of raw.matchAll(/Final-Recipient:\s*rfc822;\s*([^\s;<>]+@[^\s;<>]+)/gi)) {
        failed.add(m[1].toLowerCase());
      }
      // 2) "Original-Recipient" as a fallback
      if (failed.size === 0) {
        for (const m of raw.matchAll(/Original-Recipient:\s*rfc822;\s*([^\s;<>]+@[^\s;<>]+)/gi)) {
          failed.add(m[1].toLowerCase());
        }
      }
      if (failed.size > 0) out.push({ uid: msg.uid, failed: [...failed] });
    }
    // Mark ONLY the bounce messages as seen (never the user's real unread mail).
    const bounceUids = out.map((b) => b.uid);
    if (bounceUids.length) {
      await client.messageFlagsAdd(bounceUids, ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
  }
  return out;
}

/**
 * Apply engagement signals to a message: mark read + important, and (if it was
 * in the junk folder) move it to the inbox. Returns true if it was rescued.
 */
export async function engage(
  client: ImapFlow,
  folder: string,
  uid: number,
  opts: { rescueToInbox: boolean }
): Promise<boolean> {
  const lock = await client.getMailboxLock(folder);
  let rescued = false;
  try {
    await client.messageFlagsAdd({ uid: String(uid) }, ["\\Seen", "\\Flagged"], { uid: true });
    if (opts.rescueToInbox) {
      await client.messageMove({ uid: String(uid) }, "INBOX", { uid: true });
      rescued = true;
    }
  } finally {
    lock.release();
  }
  return rescued;
}
