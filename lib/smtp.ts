import nodemailer, { type Transporter } from "nodemailer";
import type { SendArgs } from "./resend";

// Cache one transporter per mailbox user so we don't re-handshake every send.
const pool = new Map<string, Transporter>();

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

function transporter(cfg: SmtpConfig): Transporter {
  const key = `${cfg.user}@${cfg.host}:${cfg.port}`;
  let t = pool.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    });
    pool.set(key, t);
  }
  return t;
}

/**
 * Send via SMTP (Zoho). Returns the RFC Message-ID nodemailer assigned so we
 * can record threading. `In-Reply-To` / `References` are honored if present in
 * args.headers.
 */
export async function smtpSend(
  cfg: SmtpConfig,
  args: SendArgs
): Promise<{ id: string; messageId: string | null }> {
  const info = await transporter(cfg).sendMail({
    from: args.from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
    headers: args.headers,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
  });
  const messageId = info.messageId ?? null;
  return { id: messageId ?? info.response ?? "smtp-sent", messageId };
}
