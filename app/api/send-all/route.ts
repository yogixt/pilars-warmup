import { NextResponse } from "next/server";
import { sendToAllPeers } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-shot: send an opener to every active peer, rotating across all mailboxes.
export async function POST() {
  try {
    const res = await sendToAllPeers();
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
