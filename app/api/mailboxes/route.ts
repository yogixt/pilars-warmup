import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  return req.headers.get("authorization") === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const rs = await db().execute("SELECT * FROM mailboxes ORDER BY created_at");
  return NextResponse.json({ mailboxes: rs.rows });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO mailboxes (email,display_name,provider,active,warmup_started_at,max_daily,reply_probability,created_at)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(email) DO UPDATE SET
            display_name=excluded.display_name,
            provider=excluded.provider,
            active=excluded.active,
            max_daily=excluded.max_daily,
            reply_probability=excluded.reply_probability`,
    args: [
      email,
      String(body.display_name ?? ""),
      String(body.provider ?? "resend"),
      body.active === false ? 0 : 1,
      body.warmup_started_at ?? now,
      body.max_daily ?? null,
      body.reply_probability ?? null,
      now,
    ],
  });
  return NextResponse.json({ ok: true, email });
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const email = req.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
  // Soft-deactivate rather than delete so message history stays intact.
  await db().execute({ sql: "UPDATE mailboxes SET active = 0 WHERE email = ?", args: [email] });
  return NextResponse.json({ ok: true });
}
