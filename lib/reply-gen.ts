import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "./config";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  // OPENAI_BASE_URL lets us point at any OpenAI-compatible provider — e.g. a
  // FREE one like Groq (https://api.groq.com/openai/v1) or Gemini
  // (https://generativelanguage.googleapis.com/v1beta/openai). Keeps the system $0.
  _openai = new OpenAI({ apiKey: key, baseURL: process.env.OPENAI_BASE_URL || undefined });
  return _openai;
}

// Use whichever provider has a key configured (OpenAI preferred if both set,
// since that's the key currently supplied). Falls back to canned text on error.
function hasProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// Neutral, believable subjects for fresh (non-reply) warm-up threads. Keeps the
// corpus varied so provider filters see natural, human-looking conversation.
const SUBJECT_SEEDS = [
  "Quick note before the week wraps",
  "Following up on our conversation",
  "A few thoughts for you",
  "Checking in",
  "Something worth a quick read",
  "Plan for the week ahead",
  "Draft ready for your eyes",
  "A small update from my side",
  "Circling back on that",
  "Would value your take",
  "Sharing a quick recap",
  "Touching base",
  "One thing before we sync",
  "Hope your week's going well",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function freshSubject(): string {
  return pick(SUBJECT_SEEDS);
}

const SYSTEM_OPENER = `You are writing a short, warm, professional email between two colleagues who know each other.
Rules:
- Open with a brief friendly greeting line, then 2-4 sentences of genuine, specific-sounding content.
- Polished but personal — like a thoughtful person, not a marketer. No hype, no emojis, no links.
- No sign-off or signature (that is added separately). No placeholders like [Name].
- Vary the topic and phrasing so no two emails feel templated.
- Never mention that this is automated, a test, or "warm-up".
Return ONLY the email body text.`;

const SYSTEM_REPLY = `You are replying to a short personal email between two colleagues who know each other.
Rules:
- 1-4 sentences that genuinely respond to what they said.
- Warm and casual, like a real person. No signatures or sign-offs.
- Never mention automation, tests, or "warm-up".
Return ONLY the reply body text.`;

async function generate(system: string, user: string): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    // Read the model at call time so it always matches the configured provider
    // (env is guaranteed loaded by then, unlike at module-eval time).
    const model = process.env.OPENAI_MODEL || config.openaiModel;
    const res = await openai().chat.completions.create({
      model,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return (res.choices[0]?.message?.content ?? "").trim();
  }
  const res = await anthropic().messages.create({
    model: process.env.REPLY_MODEL || config.replyModel,
    max_tokens: 300,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return (block?.text ?? "").trim();
}

/** Body for a brand-new warm-up email on the given subject. */
export async function generateOpener(subject: string): Promise<string> {
  try {
    return await generate(SYSTEM_OPENER, `Write a short email with the subject: "${subject}".`);
  } catch {
    return `Hey — wanted to touch base on "${subject}". Let me know what you think when you have a moment.`;
  }
}

/** Body for a reply to an inbound email. `incoming` may be empty if body fetch failed. */
export async function generateReply(subject: string, incoming: string): Promise<string> {
  const context = incoming.trim()
    ? `They wrote (subject "${subject}"):\n\n${incoming.slice(0, 1500)}`
    : `They emailed you with the subject "${subject}" (body unavailable). Write a friendly, plausible reply.`;
  try {
    return await generate(SYSTEM_REPLY, context);
  } catch {
    return "Thanks for this — makes sense to me. I'll take a look and get back to you shortly.";
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Clean, lightweight HTML email — nicely typeset, single column, no images or
 * CTAs (keeps it human and inbox-friendly for warm-up). Optional signature.
 */
export function toHtml(text: string, signature?: string): string {
  const body = esc(text)
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : `<p style="margin:0 0 14px">${l}</p>`))
    .join("");

  const sig = signature
    ? `<table cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #ececec;padding-top:14px">
         <tr><td style="font-size:14px;color:#111827;font-weight:600">${esc(signature)}</td></tr>
       </table>`
    : "";

  return `<div style="margin:0;padding:0;background:#f6f7f9">
    <div style="max-width:560px;margin:0 auto;padding:26px 4px">
      <div style="background:#ffffff;border:1px solid #ececec;border-radius:12px;padding:26px 28px;
                  font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:15.5px;line-height:1.65;color:#1f2937">
        ${body}${sig}
      </div>
    </div>
  </div>`;
}
