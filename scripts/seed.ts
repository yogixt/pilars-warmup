/**
 * Seed the mailbox pool with your real Zoho addresses, then run:  npm run seed
 *
 * Each mailbox needs a Zoho *app-specific password* for IMAP (Zoho Mail →
 * Settings → Security → App Passwords). Put them in .env.local as:
 *
 *   IMAP_PASS_BIJAY=...
 *   IMAP_PASS_COLLAB=...
 *   IMAP_PASS_SOLUTIONS=...
 *   IMAP_PASS_TEAM=...
 *   IMAP_PASS_VIJAY=...
 *
 * The seed reads them from the environment so passwords never live in git.
 * Passwords are stored in the Turso `mailboxes` table (internal tool). Rotate
 * them from the Zoho console if a mailbox ever leaves the pool.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv();
import { db, ensureSchema } from "../lib/db";

// Zoho India data center. If an account is on the global DC use imap.zoho.com.
const IMAP_HOST = process.env.IMAP_HOST || "imap.zoho.in";
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const SMTP_HOST = process.env.SMTP_HOST || "smtp.zoho.in";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);

// All mailboxes send via Zoho SMTP (free, works immediately, no DNS). Resend is
// unused because its free plan can't verify these domains.
const RESEND_DOMAINS = new Set<string>();
const transportFor = (email: string) =>
  RESEND_DOMAINS.has(email.split("@")[1]) ? "resend" : "smtp";

interface Seed {
  email: string;
  name: string;
  passEnv: string; // env var holding this mailbox's app password
}

const POOL: Seed[] = [
  { email: "bijay@thepilars.com", name: "Bijoy Laxmi Biswas", passEnv: "IMAP_PASS_BIJAY" },
  { email: "solutions@pilarsworks.com", name: "Pilars Solutions", passEnv: "IMAP_PASS_SOLUTIONS" },
  { email: "team@hellopilars.com", name: "Team Pilars", passEnv: "IMAP_PASS_TEAM" },
  { email: "vijay@meetpilars.com", name: "Vijay", passEnv: "IMAP_PASS_VIJAY" },
];

async function main() {
  await ensureSchema();
  const now = new Date().toISOString();
  let ready = 0;

  for (const m of POOL) {
    const pass = process.env[m.passEnv] || null;
    if (!pass) {
      console.warn(`! ${m.email}: ${m.passEnv} not set — seeding without IMAP (send-only until you add it)`);
    } else {
      ready++;
    }
    const transport = transportFor(m.email);
    await db().execute({
      sql: `INSERT INTO mailboxes
        (email,display_name,provider,active,warmup_started_at,max_daily,reply_probability,transport,imap_host,imap_port,imap_user,imap_pass,smtp_host,smtp_port,created_at)
        VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET
          display_name=excluded.display_name,
          transport=excluded.transport,
          imap_host=excluded.imap_host,
          imap_port=excluded.imap_port,
          imap_user=excluded.imap_user,
          imap_pass=COALESCE(excluded.imap_pass, mailboxes.imap_pass),
          smtp_host=excluded.smtp_host,
          smtp_port=excluded.smtp_port`,
      args: [
        m.email.toLowerCase(),
        m.name,
        "zoho",
        now,
        null,
        null,
        transport,
        IMAP_HOST,
        IMAP_PORT,
        m.email.toLowerCase(),
        pass,
        SMTP_HOST,
        SMTP_PORT,
        now,
      ],
    });
    console.log(`seeded ${m.email} [${transport}]${pass ? " (creds ready)" : ""}`);
  }

  // Deactivate any mailbox not in the pool (e.g. collab@ that we've dropped).
  const emails = POOL.map((m) => m.email.toLowerCase());
  const placeholders = emails.map(() => "?").join(",");
  const off = await db().execute({
    sql: `UPDATE mailboxes SET active = 0 WHERE lower(email) NOT IN (${placeholders}) AND active = 1`,
    args: emails,
  });
  if ((off.rowsAffected ?? 0) > 0) console.log(`deactivated ${off.rowsAffected} mailbox(es) not in pool`);

  console.log(`\nDone. ${POOL.length} mailboxes, ${ready} with IMAP credentials.`);
  if (ready < 2) {
    console.log("Warm-up needs at least 2 IMAP-ready mailboxes to form a loop.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
