import { Resend } from "resend";

let _resend: Resend | null = null;
export function resend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(key);
  return _resend;
}

export interface SendArgs {
  from: string; // "Name <addr@domain>"
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string; // funnel replies to the AgentMail agent inbox
}

/**
 * Send an email via Resend and return the Resend email id plus the RFC
 * Message-ID it was assigned (best-effort; used for our own threading records).
 */
export async function sendEmail(
  args: SendArgs
): Promise<{ id: string; messageId: string | null }> {
  const { data, error } = await resend().emails.send({
    from: args.from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
    headers: args.headers,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
  });
  if (error) throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  const id = data!.id;
  let messageId: string | null = null;
  try {
    const got = await resend().emails.get(id);
    messageId = (got.data as any)?.message_id ?? null;
  } catch {
    /* non-fatal */
  }
  return { id, messageId };
}
