import { NextRequest, NextResponse } from "next/server";
import { sendDailyReport } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manual "send the daily report now" trigger (optional ?to= override).
export async function POST(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to") || undefined;
  const res = await sendDailyReport(to);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
