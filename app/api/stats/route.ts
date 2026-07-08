import { NextResponse } from "next/server";
import { stats, recentActivity, dailySeries, recentEdges } from "@/lib/warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [s, activity, series, edges] = await Promise.all([
      stats(),
      recentActivity(40),
      dailySeries(14),
      recentEdges(60),
    ]);
    return NextResponse.json({ ok: true, stats: s, activity, series, edges });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
