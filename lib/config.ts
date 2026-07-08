function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  startPerDay: num("WARMUP_START_PER_DAY", 4),
  dailyIncrement: num("WARMUP_DAILY_INCREMENT", 3),
  maxPerDay: num("WARMUP_MAX_PER_DAY", 40),
  replyProbability: num("WARMUP_REPLY_PROBABILITY", 0.55),
  replyMinDelay: num("WARMUP_REPLY_MIN_DELAY", 3),
  replyMaxDelay: num("WARMUP_REPLY_MAX_DELAY", 45),
  sendHourStart: num("WARMUP_SEND_HOUR_START", 7),
  sendHourEnd: num("WARMUP_SEND_HOUR_END", 21),
  replyModel: process.env.REPLY_MODEL || "claude-haiku-4-5-20251001",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  // Secret tag stamped on every warm-up email (X-Warmup-Token header). The IMAP
  // poller only ever touches messages carrying this exact token, so it can never
  // act on real business mail. Keep it unguessable.
  warmupToken: process.env.WARMUP_TOKEN || "wu-set-a-real-token",
  // Default IMAP connection for mailboxes that don't specify their own.
  imapHost: process.env.IMAP_HOST || "imap.zoho.in",
  imapPort: num("IMAP_PORT", 993),
  // Stop auto-replying once a thread reaches this depth (prevents infinite ping-pong).
  maxThreadDepth: num("WARMUP_MAX_THREAD_DEPTH", 4),
  inboundLookbackDays: num("WARMUP_INBOUND_LOOKBACK_DAYS", 3),
  // Max emails a single mailbox sends per cron run. On Hobby (daily cron) this
  // lets one run send the whole day's ramped quota; keeps a lid on huge bursts.
  sendsPerRun: num("WARMUP_SENDS_PER_RUN", 20),
  // Daily report: where it's sent, and which mailbox sends it.
  reportTo: process.env.REPORT_TO || "",
  reportFrom: process.env.REPORT_FROM || "",
};

/** How many emails a mailbox should send today, based on how long it's been warming. */
export function dailyTargetForAgeDays(ageDays: number, maxDailyOverride?: number | null): number {
  const cap = maxDailyOverride && maxDailyOverride > 0 ? maxDailyOverride : config.maxPerDay;
  const target = config.startPerDay + Math.floor(Math.max(0, ageDays) * config.dailyIncrement);
  return Math.min(cap, Math.max(1, target));
}
