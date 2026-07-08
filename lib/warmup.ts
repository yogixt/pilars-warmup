import { db, ensureSchema } from "./db";
import { config, dailyTargetForAgeDays } from "./config";
import { sendEmail, type SendArgs } from "./resend";
import { smtpSend } from "./smtp";
import { generateOpener, generateReply, freshSubject, toHtml } from "./reply-gen";
import { withImap, resolveJunkPath, fetchWarmup, fetchBounces, engage, type WarmupMessage } from "./imap";
import { amListMessages, amGetMessage, amReply, agentInbox } from "./agentmail";
import { buildReportHtml, buildReportText, type ReportData } from "./report";

interface Mailbox {
  email: string;
  display_name: string;
  active: number;
  warmup_started_at: string;
  max_daily: number | null;
  reply_probability: number | null;
  transport: string; // 'resend' | 'smtp'
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_pass: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
}

/** Send `args` from mailbox `mb` using its configured transport. */
async function sendVia(mb: Mailbox, args: SendArgs): Promise<{ id: string; messageId: string | null }> {
  if (mb.transport === "smtp") {
    if (!mb.imap_pass) throw new Error(`${mb.email}: SMTP transport needs an app password`);
    return smtpSend(
      {
        host: mb.smtp_host || "smtp.zoho.in",
        port: mb.smtp_port || 465,
        user: mb.imap_user || mb.email,
        pass: mb.imap_pass,
      },
      args
    );
  }
  return sendEmail(args); // Resend
}

function nowIso(): string {
  return new Date().toISOString();
}
function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
function ageDays(startedIso: string): number {
  return (Date.now() - new Date(startedIso).getTime()) / 86_400_000;
}
function fromHeader(mb: Mailbox): string {
  return mb.display_name ? `${mb.display_name} <${mb.email}>` : mb.email;
}
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function warmupHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-Warmup-Token": config.warmupToken, ...(extra ?? {}) };
}

/** Run `fn` over items with bounded concurrency (keeps us under the time budget). */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function activeMailboxes(): Promise<Mailbox[]> {
  const rs = await db().execute("SELECT * FROM mailboxes WHERE active = 1");
  return rs.rows as unknown as Mailbox[];
}

async function sentTodayByFrom(): Promise<Map<string, number>> {
  const rs = await db().execute({
    sql: "SELECT from_addr, COUNT(*) AS c FROM messages WHERE created_day = ? AND direction = 'outbound' GROUP BY from_addr",
    args: [dayKey()],
  });
  const m = new Map<string, number>();
  for (const r of rs.rows as any[]) m.set(r.from_addr as string, Number(r.c));
  return m;
}

async function recordMessage(row: {
  id: string;
  direction: "outbound" | "inbound";
  thread_id: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  message_id: string | null;
  in_reply_to: string | null;
  is_reply: boolean;
  status?: string;
}): Promise<void> {
  await db().execute({
    sql: `INSERT OR REPLACE INTO messages
      (id,direction,thread_id,from_addr,to_addr,subject,message_id,in_reply_to,is_reply,status,created_at,created_day)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      row.id,
      row.direction,
      row.thread_id,
      row.from_addr,
      row.to_addr,
      row.subject,
      row.message_id,
      row.in_reply_to,
      row.is_reply ? 1 : 0,
      row.status ?? "sent",
      nowIso(),
      dayKey(),
    ],
  });
}

function withinSendWindow(): boolean {
  const h = new Date().getUTCHours();
  const { sendHourStart: s, sendHourEnd: e } = config;
  return s <= e ? h >= s && h < e : h >= s || h < e;
}

/* ------------------------------------------------------------------ */
/* 1. Outbound: keep every mailbox on its ramp curve                   */
/* ------------------------------------------------------------------ */

export async function runSends(opts?: { maxBurst?: number }): Promise<{ sent: number; skipped: string }> {
  await ensureSchema();
  if (!withinSendWindow()) return { sent: 0, skipped: "outside send window" };

  const boxes = await activeMailboxes();
  const contactList = await activeContacts();
  if (boxes.length < 1) return { sent: 0, skipped: "no active mailboxes" };
  if (contactList.length === 0 && boxes.length < 2)
    return { sent: 0, skipped: "need 2 mailboxes (pool mode) or at least 1 contact (campaign mode)" };

  const replyTo = agentInbox() || undefined; // funnel colleague replies to AgentMail
  const sentToday = await sentTodayByFrom();
  const perRunCap = opts?.maxBurst ?? config.sendsPerRun;

  const tasks: { mb: Mailbox; email: string; name: string }[] = [];
  for (const mb of boxes) {
    const target = dailyTargetForAgeDays(ageDays(mb.warmup_started_at), mb.max_daily);
    const already = sentToday.get(mb.email) ?? 0;
    // Send the full remaining daily quota (capped per run), since the cron may
    // only fire once a day on Hobby.
    const due = target - already;
    if (due <= 0) continue;

    const toSend = Math.min(due, perRunCap);
    for (let i = 0; i < toSend; i++) {
      const tgt = pickTarget(contactList, boxes, mb.email);
      if (tgt) tasks.push({ mb, email: tgt.email, name: tgt.name });
    }
  }

  let sent = 0;
  await mapLimit(tasks, 5, async (t) => {
    try {
      await sendOpener(t.mb, t.email, t.name, replyTo);
      sent++;
    } catch (err) {
      console.error(`send ${t.mb.email} -> ${t.email} failed`, err);
    }
  });
  return { sent, skipped: "" };
}

/**
 * One-shot: send a single opener to EVERY active peer, rotating across all
 * active mailboxes so every domain is used and every peer is covered once.
 */
export async function sendToAllPeers(): Promise<{ sent: number; errors: number; total: number }> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const contactList = await activeContacts();
  if (boxes.length === 0 || contactList.length === 0) return { sent: 0, errors: 0, total: contactList.length };
  const replyTo = agentInbox() || undefined;

  let sent = 0, errors = 0;
  for (let i = 0; i < contactList.length; i++) {
    const mb = boxes[i % boxes.length];
    const c = contactList[i];
    try {
      await sendOpener(mb, c.email, c.name, replyTo);
      sent++;
    } catch (err) {
      errors++;
      console.error(`send ${mb.email} -> ${c.email} failed`, err);
    }
  }
  return { sent, errors, total: contactList.length };
}

/** Send an opener from EVERY domain to EVERY active peer (each peer gets one per domain). */
export async function sendFromAllToAll(): Promise<{ sent: number; errors: number; total: number; domains: number; peers: number }> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const contactList = await activeContacts();
  const replyTo = agentInbox() || undefined;
  const tasks: { mb: Mailbox; email: string; name: string }[] = [];
  for (const mb of boxes) for (const c of contactList) tasks.push({ mb, email: c.email, name: c.name });

  let sent = 0, errors = 0;
  await mapLimit(tasks, 6, async (t) => {
    try {
      await sendOpener(t.mb, t.email, t.name, replyTo);
      sent++;
    } catch (e) {
      errors++;
      console.error(`send ${t.mb.email} -> ${t.email} failed`, e);
    }
  });
  return { sent, errors, total: tasks.length, domains: boxes.length, peers: contactList.length };
}

/** Send an opener to one recipient from EVERY active mailbox (skipping any listed). */
export async function sendFromAllTo(
  toEmail: string,
  toName?: string,
  skip: string[] = []
): Promise<{ sent: number; from: string[]; errors: number }> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const replyTo = agentInbox() || undefined;
  const from: string[] = [];
  let errors = 0;
  for (const mb of boxes) {
    if (skip.includes(mb.email)) continue;
    try {
      await sendOpener(mb, toEmail, toName || "", replyTo);
      from.push(mb.email);
    } catch (e) {
      errors++;
      console.error(`send ${mb.email} -> ${toEmail} failed`, e);
    }
  }
  return { sent: from.length, from, errors };
}

/** Send a single opener to one recipient from a random active mailbox. */
export async function sendOpenerTo(
  toEmail: string,
  toName?: string
): Promise<{ ok: boolean; from?: string; error?: string }> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  if (!boxes.length) return { ok: false, error: "no active mailboxes" };
  const mb = boxes[Math.floor(Math.random() * boxes.length)];
  const replyTo = agentInbox() || undefined;
  try {
    await sendOpener(mb, toEmail, toName || "", replyTo);
    return { ok: true, from: mb.email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface Target { email: string; name: string }

async function activeContacts(): Promise<Target[]> {
  const rs = await db().execute("SELECT email, name FROM contacts WHERE active = 1");
  return rs.rows as unknown as Target[];
}

// Campaign mode: send to the colleague contacts. Pool mode (no contacts yet):
// fall back to sending between pool mailboxes so warm-up still works.
function pickTarget(contacts: Target[], boxes: Mailbox[], notEmail: string): Target | null {
  if (contacts.length > 0) {
    return contacts[Math.floor(Math.random() * contacts.length)];
  }
  const others = boxes.filter((b) => b.email !== notEmail);
  if (others.length === 0) return null;
  const o = others[Math.floor(Math.random() * others.length)];
  return { email: o.email, name: o.display_name };
}

async function sendOpener(
  from: Mailbox,
  toEmail: string,
  toName: string,
  replyTo?: string
): Promise<void> {
  const subject = freshSubject();
  const body = await generateOpener(subject);
  const { id, messageId } = await sendVia(from, {
    from: fromHeader(from),
    to: toEmail,
    subject,
    text: body,
    html: toHtml(body, from.display_name),
    headers: warmupHeaders(),
    replyTo,
  });
  const threadId = messageId ?? id;
  await recordMessage({
    id,
    direction: "outbound",
    thread_id: threadId,
    from_addr: from.email,
    to_addr: toEmail,
    subject,
    message_id: messageId,
    in_reply_to: null,
    is_reply: false,
  });
}

/* ------------------------------------------------------------------ */
/* 2. Inbound: poll IMAP, engage, and queue human-like replies         */
/* ------------------------------------------------------------------ */

export async function runInboundPoll(): Promise<{
  inboundProcessed: number;
  repliesScheduled: number;
  rescuedFromSpam: number;
  errors: number;
}> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const pool = new Set(boxes.map((b) => b.email.toLowerCase()));

  let inboundProcessed = 0;
  let repliesScheduled = 0;
  let rescuedFromSpam = 0;
  let errors = 0;

  for (const mb of boxes) {
    if (!mb.imap_pass) continue; // no creds -> cannot poll this box
    const cfg = {
      host: mb.imap_host || config.imapHost,
      port: mb.imap_port || config.imapPort,
      user: mb.imap_user || mb.email,
      pass: mb.imap_pass,
    };

    try {
      await withImap(cfg, async (client) => {
        const junkPath = await resolveJunkPath(client);
        const folders: { path: string; junk: boolean }[] = [{ path: "INBOX", junk: false }];
        if (junkPath) folders.push({ path: junkPath, junk: true });

        for (const folder of folders) {
          const msgs = await fetchWarmup(client, folder.path, {
            token: config.warmupToken,
            pool,
            sinceDays: config.inboundLookbackDays,
          });

          for (const m of msgs) {
            // Engagement first (mark read/important, rescue from spam). We mark
            // \Seen here so the message won't be re-fetched on the next poll.
            try {
              const rescued = await engage(client, folder.path, m.uid, {
                rescueToInbox: folder.junk,
              });
              if (rescued) rescuedFromSpam++;
            } catch (err) {
              console.error(`engage failed ${mb.email} ${m.messageId}`, err);
            }

            // Skip bookkeeping/reply if we've already processed this message id.
            const seen = await db().execute({
              sql: "SELECT 1 FROM messages WHERE id = ?",
              args: [m.messageId],
            });
            if (seen.rows.length) continue;

            const threadId = m.references[0] || m.inReplyTo || m.messageId;
            await recordMessage({
              id: m.messageId,
              direction: "inbound",
              thread_id: threadId,
              from_addr: m.from,
              to_addr: mb.email,
              subject: m.subject,
              message_id: m.messageId,
              in_reply_to: m.inReplyTo,
              is_reply: /^re:/i.test(m.subject),
              status: "received",
            });
            inboundProcessed++;

            if (await maybeScheduleReply(mb, m, threadId)) repliesScheduled++;
          }
        }
      });
    } catch (err) {
      errors++;
      console.error(`IMAP poll failed for ${mb.email}`, err);
    }
  }

  return { inboundProcessed, repliesScheduled, rescuedFromSpam, errors };
}

async function maybeScheduleReply(
  mb: Mailbox,
  m: WarmupMessage,
  threadId: string
): Promise<boolean> {
  const depth = m.references.length;
  if (depth >= config.maxThreadDepth) return false;

  const replyProb = mb.reply_probability ?? config.replyProbability;
  if (Math.random() > replyProb) return false;

  const delayMin = rand(config.replyMinDelay, config.replyMaxDelay);
  const replyAfter = new Date(Date.now() + delayMin * 60_000).toISOString();
  const references = [...m.references, m.messageId].join(" ");

  await db().execute({
    sql: `INSERT OR REPLACE INTO pending_replies
      (id,reply_from,reply_to,subject,thread_id,in_reply_to,references_chain,incoming_text,reply_after,processed,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    args: [
      m.messageId,
      mb.email,
      m.from,
      m.subject,
      threadId,
      m.messageId,
      references,
      m.text.slice(0, 4000),
      replyAfter,
      nowIso(),
    ],
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* 3. Deferred replies: send whatever is now due                       */
/* ------------------------------------------------------------------ */

export async function runPendingReplies(limit = 25): Promise<{ replied: number }> {
  await ensureSchema();
  const rs = await db().execute({
    sql: "SELECT * FROM pending_replies WHERE processed = 0 AND reply_after <= ? ORDER BY reply_after ASC LIMIT ?",
    args: [nowIso(), limit],
  });

  let replied = 0;
  for (const row of rs.rows as any[]) {
    try {
      const mbRs = await db().execute({
        sql: "SELECT * FROM mailboxes WHERE email = ?",
        args: [row.reply_from],
      });
      const mb = (mbRs.rows[0] as unknown as Mailbox) || null;
      if (!mb || !mb.active) {
        await markProcessed(row.id);
        continue;
      }

      const replyText = await generateReply(row.subject, row.incoming_text ?? "");
      const subject = /^re:/i.test(row.subject) ? row.subject : `Re: ${row.subject}`;

      const headers = warmupHeaders();
      if (row.in_reply_to) {
        headers["In-Reply-To"] = row.in_reply_to;
        headers["References"] = row.references_chain || row.in_reply_to;
      }

      const { id, messageId } = await sendVia(mb, {
        from: fromHeader(mb),
        to: row.reply_to,
        subject,
        text: replyText,
        html: toHtml(replyText, mb.display_name),
        headers,
      });

      await recordMessage({
        id,
        direction: "outbound",
        thread_id: row.thread_id,
        from_addr: mb.email,
        to_addr: row.reply_to,
        subject,
        message_id: messageId,
        in_reply_to: row.in_reply_to || null,
        is_reply: true,
      });
      await markProcessed(row.id);
      replied++;
    } catch (err) {
      console.error(`reply for ${row.id} failed`, err);
      // Leave unprocessed so it retries next tick.
    }
  }
  return { replied };
}

async function markProcessed(id: string): Promise<void> {
  await db().execute({
    sql: "UPDATE pending_replies SET processed = 1 WHERE id = ?",
    args: [id],
  });
}

/* ------------------------------------------------------------------ */
/* 3. IMAP sweep: one connection per mailbox, all mailboxes in parallel */
/*    (inbound engage + schedule replies + bounce auto-removal)         */
/* ------------------------------------------------------------------ */

export interface ImapSweepResult {
  inboundProcessed: number;
  repliesScheduled: number;
  rescuedFromSpam: number;
  bouncesRemoved: number;
  errors: number;
}

export async function runImapSweep(): Promise<ImapSweepResult> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const pool = new Set(boxes.map((b) => b.email.toLowerCase()));

  const zero = (): ImapSweepResult => ({
    inboundProcessed: 0, repliesScheduled: 0, rescuedFromSpam: 0, bouncesRemoved: 0, errors: 0,
  });

  const perBox = await Promise.all(
    boxes.map(async (mb): Promise<ImapSweepResult> => {
      const acc = zero();
      if (!mb.imap_pass) return acc;
      const cfg = {
        host: mb.imap_host || config.imapHost,
        port: mb.imap_port || config.imapPort,
        user: mb.imap_user || mb.email,
        pass: mb.imap_pass,
      };
      try {
        await withImap(cfg, async (client) => {
          const junkPath = await resolveJunkPath(client);
          const folders: { path: string; junk: boolean }[] = [{ path: "INBOX", junk: false }];
          if (junkPath) folders.push({ path: junkPath, junk: true });

          // (1) warm-up inbound: engage + schedule replies
          for (const folder of folders) {
            const msgs = await fetchWarmup(client, folder.path, {
              token: config.warmupToken, pool, sinceDays: config.inboundLookbackDays,
            });
            for (const m of msgs) {
              try {
                if (await engage(client, folder.path, m.uid, { rescueToInbox: folder.junk })) acc.rescuedFromSpam++;
              } catch (err) {
                console.error(`engage ${mb.email} ${m.messageId}`, err);
              }
              const seen = await db().execute({ sql: "SELECT 1 FROM messages WHERE id = ?", args: [m.messageId] });
              if (seen.rows.length) continue;
              const threadId = m.references[0] || m.inReplyTo || m.messageId;
              await recordMessage({
                id: m.messageId, direction: "inbound", thread_id: threadId, from_addr: m.from,
                to_addr: mb.email, subject: m.subject, message_id: m.messageId, in_reply_to: m.inReplyTo,
                is_reply: /^re:/i.test(m.subject), status: "received",
              });
              acc.inboundProcessed++;
              if (await maybeScheduleReply(mb, m, threadId)) acc.repliesScheduled++;
            }
          }

          // (2) bounces in INBOX (warm-up msgs are already \Seen from engage)
          const bounces = await fetchBounces(client, "INBOX", config.inboundLookbackDays);
          for (const b of bounces) {
            for (const addr of b.failed) {
              const res = await db().execute({
                sql: "UPDATE contacts SET active = 0 WHERE lower(email) = ? AND active = 1",
                args: [addr],
              });
              if ((res.rowsAffected ?? 0) > 0) {
                acc.bouncesRemoved++;
                console.warn(`bounce: deactivated peer ${addr} (hard-bounced to ${mb.email})`);
              }
            }
          }
        });
      } catch (err) {
        acc.errors++;
        console.error(`IMAP sweep failed for ${mb.email}`, err);
      }
      return acc;
    })
  );

  return perBox.reduce((a, x) => ({
    inboundProcessed: a.inboundProcessed + x.inboundProcessed,
    repliesScheduled: a.repliesScheduled + x.repliesScheduled,
    rescuedFromSpam: a.rescuedFromSpam + x.rescuedFromSpam,
    bouncesRemoved: a.bouncesRemoved + x.bouncesRemoved,
    errors: a.errors + x.errors,
  }), zero());
}

/* --- legacy split functions (kept for compatibility) --- */

export async function runBounceSweep(): Promise<{ removed: number; addresses: string[] }> {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const removed = new Set<string>();

  for (const mb of boxes) {
    if (!mb.imap_pass) continue;
    const cfg = {
      host: mb.imap_host || config.imapHost,
      port: mb.imap_port || config.imapPort,
      user: mb.imap_user || mb.email,
      pass: mb.imap_pass,
    };
    try {
      await withImap(cfg, async (client) => {
        const bounces = await fetchBounces(client, "INBOX", config.inboundLookbackDays);
        for (const b of bounces) {
          for (const addr of b.failed) {
            // Deactivate the bounced contact (self-healing list).
            const res = await db().execute({
              sql: "UPDATE contacts SET active = 0 WHERE lower(email) = ? AND active = 1",
              args: [addr],
            });
            if ((res.rowsAffected ?? 0) > 0) {
              removed.add(addr);
              console.warn(`bounce: deactivated peer ${addr} (hard-bounced to ${mb.email})`);
            }
          }
        }
      });
    } catch (err) {
      console.error(`bounce sweep failed for ${mb.email}`, err);
    }
  }
  return { removed: removed.size, addresses: [...removed] };
}

/* ------------------------------------------------------------------ */
/* 3b. AgentMail brain: auto-reply to colleague replies                */
/* ------------------------------------------------------------------ */

function bareAddr(h?: string): string {
  if (!h) return "";
  const m = h.match(/<([^>]+)>/);
  return (m ? m[1] : h).trim().toLowerCase();
}

/**
 * Colleague replies (Reply-To → the AgentMail inbox) land in AgentMail. Read
 * new ones, generate a Claude reply, and answer via the AgentMail API.
 */
export async function runAgentMailReplies(): Promise<{
  processed: number;
  replied: number;
  errors: number;
}> {
  await ensureSchema();
  const inbox = agentInbox();
  if (!inbox || !process.env.AGENTMAIL_API_KEY) {
    return { processed: 0, replied: 0, errors: 0 };
  }

  let list;
  try {
    list = await amListMessages(inbox, 25);
  } catch (err) {
    console.error("AgentMail list failed", err);
    return { processed: 0, replied: 0, errors: 1 };
  }

  const inboxAddr = inbox.toLowerCase();
  let processed = 0;
  let replied = 0;
  let errors = 0;

  for (const m of list) {
    const labels = m.labels ?? [];
    const from = bareAddr(m.from);
    // Only genuine inbound from someone else: has 'received', not our own 'sent'.
    if (from === inboxAddr) continue;
    if (labels.includes("sent")) continue;
    if (!labels.includes("received")) continue;

    // Dedupe against what we've already recorded/answered.
    const seen = await db().execute({ sql: "SELECT 1 FROM messages WHERE id = ?", args: [m.message_id] });
    if (seen.rows.length) continue;

    const threadId = m.thread_id || m.message_id;
    await recordMessage({
      id: m.message_id,
      direction: "inbound",
      thread_id: threadId,
      from_addr: from,
      to_addr: inbox,
      subject: m.subject ?? "",
      message_id: m.message_id,
      in_reply_to: null,
      is_reply: /^re:/i.test(m.subject ?? ""),
      status: "received",
    });
    processed++;

    // Safety cap: don't keep an infinite ping-pong going on one thread.
    const depth = await db().execute({
      sql: "SELECT COUNT(*) c FROM messages WHERE thread_id = ?",
      args: [threadId],
    });
    if (Number((depth.rows[0] as any).c) > config.maxThreadDepth * 2) continue;

    try {
      let bodyText = m.preview ?? "";
      try {
        const full = await amGetMessage(inbox, m.message_id);
        bodyText = full.text || bodyText;
      } catch {
        /* fall back to preview */
      }
      const replyText = await generateReply(m.subject ?? "", bodyText);
      const res = await amReply(inbox, m.message_id, {
        text: replyText,
        html: toHtml(replyText),
      });
      await recordMessage({
        id: res.message_id,
        direction: "outbound",
        thread_id: threadId,
        from_addr: inbox,
        to_addr: from,
        subject: /^re:/i.test(m.subject ?? "") ? m.subject ?? "" : `Re: ${m.subject ?? ""}`,
        message_id: res.message_id,
        in_reply_to: m.message_id,
        is_reply: true,
      });
      replied++;
    } catch (err) {
      errors++;
      console.error(`AgentMail reply failed for ${m.message_id}`, err);
    }
  }

  return { processed, replied, errors };
}

/* ------------------------------------------------------------------ */
/* 4. Dashboard stats                                                  */
/* ------------------------------------------------------------------ */

export async function stats() {
  await ensureSchema();
  const boxes = await activeMailboxes();
  const today = dayKey();
  const q = async (sql: string) =>
    Number(((await db().execute({ sql, args: [today] })).rows[0] as any).c);

  const sentToday = await q(
    "SELECT COUNT(*) c FROM messages WHERE created_day=? AND direction='outbound'"
  );
  const repliesToday = await q(
    "SELECT COUNT(*) c FROM messages WHERE created_day=? AND direction='outbound' AND is_reply=1"
  );
  const receivedToday = await q(
    "SELECT COUNT(*) c FROM messages WHERE created_day=? AND direction='inbound'"
  );
  const pending = Number(
    ((await db().execute("SELECT COUNT(*) c FROM pending_replies WHERE processed=0")).rows[0] as any).c
  );
  const contactsCount = Number(
    ((await db().execute("SELECT COUNT(*) c FROM contacts WHERE active=1")).rows[0] as any).c
  );

  const perBox = boxes.map((b) => ({
    email: b.email,
    ageDays: Math.floor(ageDays(b.warmup_started_at)),
    target: dailyTargetForAgeDays(ageDays(b.warmup_started_at), b.max_daily),
    imap: Boolean(b.imap_pass),
  }));

  return {
    mailboxes: boxes.length,
    contacts: contactsCount,
    sentToday,
    repliesToday,
    receivedToday,
    pendingReplies: pending,
    perBox,
  };
}

/**
 * Compose and email the daily report (styled like the console). Sends from EVERY
 * active mailbox (all 4 domains) to every recipient in REPORT_TO — so it doubles
 * as daily warm-up traffic.
 */
export async function sendDailyReport(
  toOverride?: string
): Promise<{ ok: boolean; sent: number; errors: number; recipients: string[]; from: string[]; error?: string }> {
  await ensureSchema();
  const raw = toOverride || process.env.REPORT_TO || config.reportTo;
  const recipients = (raw || "").split(/[\s,;]+/).filter((x) => x.includes("@"));
  if (recipients.length === 0)
    return { ok: false, sent: 0, errors: 0, recipients: [], from: [], error: "REPORT_TO not set" };

  const boxes = await activeMailboxes();
  if (boxes.length === 0)
    return { ok: false, sent: 0, errors: 0, recipients, from: [], error: "no active mailboxes" };

  const s = await stats();
  const series = await dailySeries(14);
  const act = await recentActivity(8);
  const sent14 = series.reduce((a, d) => a + d.outbound, 0);
  const recv14 = series.reduce((a, d) => a + d.inbound, 0);

  const data: ReportData = {
    date: new Date().toISOString().slice(0, 10),
    sentToday: s.sentToday,
    repliesToday: s.repliesToday,
    receivedToday: s.receivedToday,
    contacts: s.contacts,
    mailboxes: s.mailboxes,
    imapReady: s.perBox.filter((b) => b.imap).length,
    sent14,
    recv14,
    perBox: s.perBox.map((b) => ({ email: b.email, target: b.target, imap: b.imap })),
    activity: act.map((a) => ({
      tag: a.direction === "inbound" ? "recv" : a.is_reply ? "reply" : "sent",
      from: a.from_addr.split("@")[0],
      to: a.to_addr.split("@")[0],
      subject: a.subject,
    })),
  };

  const subject = `Pilars Warm-up · Daily Report · ${data.date}`;
  const html = buildReportHtml(data);
  const text = buildReportText(data);

  let sent = 0, errors = 0;
  const fromDomains: string[] = [];
  for (const mb of boxes) {
    fromDomains.push(mb.email);
    for (const rcpt of recipients) {
      try {
        await sendVia(mb, { from: fromHeader(mb), to: rcpt, subject, text, html });
        sent++;
      } catch (e) {
        errors++;
        console.error(`report ${mb.email} -> ${rcpt} failed`, e);
      }
    }
  }
  return { ok: sent > 0, sent, errors, recipients, from: fromDomains };
}

export interface ActivityItem {
  id: string;
  direction: "outbound" | "inbound";
  is_reply: number;
  from_addr: string;
  to_addr: string;
  subject: string;
  status: string;
  created_at: string;
}

/** Most recent messages for the live feed. */
export async function recentActivity(limit = 40): Promise<ActivityItem[]> {
  await ensureSchema();
  const rs = await db().execute({
    sql: `SELECT id,direction,is_reply,from_addr,to_addr,subject,status,created_at
          FROM messages ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows as unknown as ActivityItem[];
}

/** Per-day outbound/inbound counts for the last `days` days (oldest first). */
export async function dailySeries(days = 14): Promise<
  { day: string; outbound: number; inbound: number; replies: number }[]
> {
  await ensureSchema();
  const rs = await db().execute({
    sql: `SELECT created_day AS day,
                 SUM(direction='outbound') AS outbound,
                 SUM(direction='inbound')  AS inbound,
                 SUM(direction='outbound' AND is_reply=1) AS replies
          FROM messages
          WHERE created_day >= ?
          GROUP BY created_day`,
    args: [dayKey(new Date(Date.now() - days * 86_400_000))],
  });
  const map = new Map<string, { outbound: number; inbound: number; replies: number }>();
  for (const r of rs.rows as any[]) {
    map.set(r.day, {
      outbound: Number(r.outbound || 0),
      inbound: Number(r.inbound || 0),
      replies: Number(r.replies || 0),
    });
  }
  const out: { day: string; outbound: number; inbound: number; replies: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(new Date(Date.now() - i * 86_400_000));
    out.push({ day: d, ...(map.get(d) ?? { outbound: 0, inbound: 0, replies: 0 }) });
  }
  return out;
}

/** Recent send edges between pool members, for the network graph. */
export async function recentEdges(limit = 60): Promise<
  { from: string; to: string; is_reply: number }[]
> {
  await ensureSchema();
  const rs = await db().execute({
    sql: `SELECT from_addr AS "from", to_addr AS "to", is_reply
          FROM messages WHERE direction='outbound'
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows as unknown as { from: string; to: string; is_reply: number }[];
}
