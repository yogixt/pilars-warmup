import { NextRequest, NextResponse } from "next/server";
import { runSends, runPendingReplies, runImapSweep, runAgentMailReplies, sendDailyReport } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -> open (dev only)
  const auth = req.headers.get("authorization");
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  if (auth === `Bearer ${secret}`) return true;
  // Allow ?key= for manual triggering.
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Order matters: send due replies, then poll for new inbound (engage +
  // schedule replies), then top up outbound sends for the ramp.
  const replies = await runPendingReplies();
  const imap = await runImapSweep();
  const agentmail = await runAgentMailReplies();
  const sends = await runSends();
  const report = await sendDailyReport(); // emails the daily summary (no-op if REPORT_TO unset)
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    repliesSent: replies.replied,
    imap,
    agentmail,
    sends,
    report,
  });
}
