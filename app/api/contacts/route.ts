import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open like /api/stats and /api/run so the dashboard's Peers panel can manage
// contacts directly. Put the app behind Vercel Deployment Protection in prod.
function authorized(_req: NextRequest): boolean {
  return true;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const rs = await db().execute("SELECT * FROM contacts WHERE active = 1 ORDER BY created_at");
  return NextResponse.json({ count: rs.rows.length, contacts: rs.rows });
}

/**
 * Bulk-add the ~50 colleague recipients.
 * Body: { contacts: [{ email, name? }, ...] }  OR  { emails: "a@x.com, b@y.com" }
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await req.json().catch(() => ({}));

  let items: { email: string; name?: string }[] = [];
  if (Array.isArray(body.contacts)) {
    items = body.contacts;
  } else if (typeof body.emails === "string") {
    items = body.emails
      .split(/[\s,;\n]+/)
      .filter(Boolean)
      .map((e: string) => ({ email: e }));
  }

  const now = new Date().toISOString();
  let added = 0;
  for (const it of items) {
    const email = String(it.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    await db().execute({
      sql: `INSERT INTO contacts (email,name,active,created_at) VALUES (?,?,1,?)
            ON CONFLICT(email) DO UPDATE SET name=excluded.name, active=1`,
      args: [email, String(it.name ?? ""), now],
    });
    added++;
  }
  return NextResponse.json({ ok: true, added });
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureSchema();
  const email = req.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
  await db().execute({ sql: "UPDATE contacts SET active = 0 WHERE email = ?", args: [email] });
  return NextResponse.json({ ok: true });
}
