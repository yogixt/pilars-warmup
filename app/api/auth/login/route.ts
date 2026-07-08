import { NextRequest, NextResponse } from "next/server";
import { authToken, AUTH_COOKIE } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const user = String(body.user ?? "").trim();
  const password = String(body.password ?? "");

  const expectUser = process.env.AUTH_USER || "admin";
  const expectPass = process.env.AUTH_PASSWORD || "";

  if (!expectPass) {
    return NextResponse.json({ ok: true, note: "auth disabled" });
  }
  if (user !== expectUser || password !== expectPass) {
    return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

// Logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, secure: true, path: "/", maxAge: 0 });
  return res;
}
