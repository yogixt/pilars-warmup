import { NextRequest, NextResponse } from "next/server";
import { runAgentMailReplies } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AgentMail posts here when a colleague reply arrives. We don't trust the body —
// we just use the ping to process the inbox (runAgentMailReplies is idempotent:
// it only answers genuine, not-yet-processed inbound). Gated by ?key=CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await runAgentMailReplies();
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// AgentMail may send a GET to verify the endpoint.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "agentmail-webhook" });
}
