import { createClient, type Client } from "@libsql/client";

let _db: Client | null = null;

export function db(): Client {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  _db = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mailboxes (
  email               TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL DEFAULT '',
  provider            TEXT NOT NULL DEFAULT 'resend',
  active              INTEGER NOT NULL DEFAULT 1,
  warmup_started_at   TEXT NOT NULL,
  max_daily           INTEGER,          -- overrides global cap when set
  reply_probability   REAL,             -- overrides global when set
  transport           TEXT NOT NULL DEFAULT 'resend', -- 'resend' | 'smtp'
  imap_host           TEXT,             -- e.g. imap.zoho.in
  imap_port           INTEGER,          -- e.g. 993
  imap_user           TEXT,             -- usually = email
  imap_pass           TEXT,             -- Zoho app-specific password (also used for SMTP)
  smtp_host           TEXT,             -- e.g. smtp.zoho.in (only for transport='smtp')
  smtp_port           INTEGER,          -- e.g. 465
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,       -- resend email id (outbound) or received id (inbound)
  direction     TEXT NOT NULL,          -- 'outbound' | 'inbound'
  thread_id     TEXT NOT NULL,          -- root rfc message-id of the conversation
  from_addr     TEXT NOT NULL,
  to_addr       TEXT NOT NULL,
  subject       TEXT NOT NULL DEFAULT '',
  message_id    TEXT,                   -- rfc Message-ID header of this message
  in_reply_to   TEXT,                   -- rfc In-Reply-To of this message
  is_reply      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'sent',
  created_at    TEXT NOT NULL,
  created_day   TEXT NOT NULL           -- YYYY-MM-DD (UTC) for fast daily counting
);
CREATE INDEX IF NOT EXISTS idx_messages_from_day ON messages(from_addr, created_day);
CREATE INDEX IF NOT EXISTS idx_messages_thread   ON messages(thread_id);

CREATE TABLE IF NOT EXISTS pending_replies (
  id                 TEXT PRIMARY KEY,   -- received email id
  reply_from         TEXT NOT NULL,      -- one of our mailboxes (the recipient of inbound)
  reply_to           TEXT NOT NULL,      -- the original sender we reply back to
  subject            TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  in_reply_to        TEXT NOT NULL,      -- rfc message-id we are answering
  references_chain   TEXT NOT NULL DEFAULT '',
  incoming_text      TEXT NOT NULL DEFAULT '', -- body of the email we are replying to (for context)
  reply_after        TEXT NOT NULL,      -- ISO time we are allowed to send the reply
  processed          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_due ON pending_replies(processed, reply_after);

-- The ~50 office colleagues the pool sends to (campaign recipients).
CREATE TABLE IF NOT EXISTS contacts (
  email        TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
`;

let _ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!_ready) _ready = db().executeMultiple(SCHEMA);
  return _ready;
}
