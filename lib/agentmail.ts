// Minimal AgentMail v0 client. AgentMail is the "reply automation brain":
// colleague replies (Reply-To: the agent inbox) land here, and the agent
// answers them. Docs: https://docs.agentmail.to
const BASE = "https://api.agentmail.to/v0";

function key(): string {
  const k = process.env.AGENTMAIL_API_KEY;
  if (!k) throw new Error("AGENTMAIL_API_KEY is not set");
  return k;
}
export function agentInbox(): string {
  return process.env.AGENTMAIL_INBOX || "";
}

async function req(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const txt = await r.text();
  let body: any = null;
  try {
    body = txt ? JSON.parse(txt) : null;
  } catch {
    body = txt;
  }
  if (!r.ok) {
    throw new Error(`AgentMail ${init?.method ?? "GET"} ${path} -> ${r.status}: ${txt.slice(0, 300)}`);
  }
  return body;
}

export interface AmMessage {
  message_id: string;
  thread_id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  text?: string;
  html?: string;
  labels?: string[];
  timestamp?: string;
  [k: string]: any;
}

export async function amListMessages(inbox: string, limit = 20): Promise<AmMessage[]> {
  const enc = encodeURIComponent(inbox);
  const res = await req(`/inboxes/${enc}/messages?limit=${limit}`);
  return (res?.messages ?? []) as AmMessage[];
}

export async function amGetMessage(inbox: string, messageId: string): Promise<AmMessage> {
  const enc = encodeURIComponent(inbox);
  return (await req(`/inboxes/${enc}/messages/${encodeURIComponent(messageId)}`)) as AmMessage;
}

/** Reply to a received message, threading correctly (AgentMail handles headers). */
export async function amReply(
  inbox: string,
  messageId: string,
  body: { text: string; html?: string; reply_to?: string }
): Promise<{ message_id: string; thread_id: string }> {
  const enc = encodeURIComponent(inbox);
  return (await req(`/inboxes/${enc}/messages/${encodeURIComponent(messageId)}/reply`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as { message_id: string; thread_id: string };
}

/** Send a brand-new message from the agent inbox. */
export async function amSend(
  inbox: string,
  msg: { to: string | string[]; subject: string; text: string; html?: string; reply_to?: string }
): Promise<{ message_id: string; thread_id: string }> {
  const enc = encodeURIComponent(inbox);
  return (await req(`/inboxes/${enc}/messages/send`, {
    method: "POST",
    body: JSON.stringify(msg),
  })) as { message_id: string; thread_id: string };
}
