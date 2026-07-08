import { NextResponse } from "next/server";
import { runPendingReplies, runImapSweep, runSends, runAgentMailReplies } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manual "run one tick now" trigger for the dashboard button. This is the same
// work the cron does. It is intentionally same-origin only (no secret) for the
// internal dashboard; put the app behind Vercel auth if you expose it.
export async function POST() {
  try {
    const replies = await runPendingReplies();
    const imap = await runImapSweep();
    const agentmail = await runAgentMailReplies();
    const sends = await runSends();
    return NextResponse.json({
      ok: true,
      repliesSent: replies.replied,
      imap,
      bounces: { removed: imap.bouncesRemoved },
      inbound: imap,
      agentmail,
      sends,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
