// Email-safe HTML daily report, styled to match the Pilars Warm-up console
// (dark theme, window-chrome dots, big orange/green numbers, mono, status pills).
// Table-based + inline styles for Gmail/Outlook compatibility (no SVG/external CSS).

export interface ReportData {
  date: string;
  sentToday: number;
  repliesToday: number;
  receivedToday: number;
  contacts: number;
  mailboxes: number;
  imapReady: number;
  sent14: number;
  recv14: number;
  perBox: { email: string; target: number; imap: boolean }[];
  activity: { tag: string; from: string; to: string; subject: string }[];
}

const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,monospace";
const C = { bg: "#0a0a0c", card: "#131317", border: "#26262c", text: "#ededf0", muted: "#8a8a94", faint: "#55555f", orange: "#ff8a3d", green: "#5fd08a", amber: "#f5b544", blue: "#6ab7ff" };

function statCell(label: string, value: number | string, color: string) {
  return `<td width="33%" style="padding:6px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:10px">
      <tr><td style="padding:16px 18px">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted}">${label}</div>
        <div style="font-family:${MONO};font-size:38px;font-weight:800;color:${color};line-height:1;margin-top:10px">${value}</div>
      </td></tr>
    </table>
  </td>`;
}

function pill(text: string, color: string) {
  return `<span style="font-family:${MONO};font-size:11px;font-weight:700;text-transform:uppercase;color:${color};border:1px solid ${color};border-radius:999px;padding:3px 10px">${text}</span>`;
}

export function buildReportHtml(d: ReportData): string {
  const boxRows = d.perBox.map((b) => {
    const pctW = Math.min(100, Math.round((b.target / 40) * 100));
    const dot = b.imap ? C.green : "#ff6b6b";
    return `<tr>
      <td style="padding:8px 0;font-family:${MONO};font-size:13px;color:${C.text}">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot}"></span>&nbsp; ${b.email}
      </td>
      <td align="right" style="padding:8px 0;font-family:${MONO};font-size:13px;color:${C.muted}">${b.target}/day</td>
      <td width="120" style="padding:8px 0 8px 14px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#25252b;border-radius:99px"><tr>
          <td style="background:${C.orange};height:6px;width:${pctW}%;border-radius:99px;font-size:0;line-height:0">&nbsp;</td>
          <td style="font-size:0;line-height:0">&nbsp;</td>
        </tr></table>
      </td>
    </tr>`;
  }).join("");

  const tagColor: Record<string, string> = { sent: C.orange, reply: C.green, recv: C.blue };
  const actRows = d.activity.slice(0, 6).map((a) => `<tr>
      <td width="60" style="padding:7px 0"><span style="font-family:${MONO};font-size:10px;font-weight:700;text-transform:uppercase;color:${tagColor[a.tag] || C.muted};border:1px solid ${tagColor[a.tag] || C.muted};border-radius:5px;padding:2px 7px">${a.tag}</span></td>
      <td style="padding:7px 0;font-family:${MONO};font-size:12.5px;color:${C.muted}">
        <span style="color:${C.orange}">${a.from}</span> &rarr; <span style="color:${C.text}">${a.to}</span> · ${a.subject || "(no subject)"}
      </td>
    </tr>`).join("");

  const steps = [
    { on: true, label: "AgentMail auto-reply (Groq)" },
    { on: d.contacts > 0, label: `Peers loaded · ${d.contacts}` },
    { on: d.imapReady > 0, label: `Zoho SMTP send · ${d.imapReady}/${d.mailboxes}` },
    { on: d.imapReady > 0, label: "Bounce guard" },
  ];
  const stepRows = steps.map((s) => `<tr><td style="padding:6px 0;font-family:${MONO};font-size:13.5px;color:${s.on ? C.text : C.muted}">
      <span style="color:${s.on ? C.green : C.amber}">${s.on ? "✓" : "△"}</span>&nbsp; ${s.label}
    </td></tr>`).join("");

  return `<div style="margin:0;padding:0;background:${C.bg}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 0">
   <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px">

      <!-- window chrome -->
      <tr><td style="background:#101015;border:1px solid ${C.border};border-radius:12px 12px 0 0;padding:14px 18px">
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#ff5f57"></span>
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#febc2e;margin:0 6px"></span>
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#28c840"></span>
        <span style="font-family:${MONO};font-size:14px;color:${C.muted};margin-left:12px">pilars warm-up · daily report</span>
      </td></tr>

      <!-- title -->
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:none;padding:20px 20px 6px">
        <div style="font-family:${MONO};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.orange}">${d.date}</div>
        <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:26px;font-weight:800;color:${C.text};margin-top:6px">Today&rsquo;s warm-up summary</div>
      </td></tr>

      <!-- big stats -->
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:none;padding:8px 12px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>${statCell("Sent", d.sentToday, C.orange)}${statCell("Replies", d.repliesToday, C.green)}${statCell("Received", d.receivedToday, C.blue)}</tr>
          <tr>${statCell("Peers", d.contacts, C.text)}${statCell("Mailboxes", d.mailboxes, C.text)}${statCell("14d sent", d.sent14, C.amber)}</tr>
        </table>
      </td></tr>

      <!-- pipeline -->
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:none;padding:16px 20px">
        <table width="100%"><tr>
          <td style="font-family:${MONO};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.text}">Pipeline status</td>
          <td align="right">${d.imapReady > 0 ? pill("ready", C.green) : pill("send pending", C.amber)}</td>
        </tr></table>
        <table width="100%" style="margin-top:6px">${stepRows}</table>
      </td></tr>

      <!-- per-mailbox -->
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:none;padding:16px 20px">
        <div style="font-family:${MONO};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.text};margin-bottom:6px">Per-mailbox ramp</div>
        <table width="100%">${boxRows}</table>
      </td></tr>

      <!-- activity -->
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:none;border-radius:0 0 12px 12px;padding:16px 20px">
        <div style="font-family:${MONO};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.text};margin-bottom:6px">Recent activity</div>
        <table width="100%">${actRows || `<tr><td style="font-family:${MONO};font-size:12.5px;color:${C.muted};padding:6px 0">no activity today</td></tr>`}</table>
      </td></tr>

      <tr><td align="center" style="padding:16px 0;font-family:${MONO};font-size:11px;color:${C.faint}">pilars warm-up · automated daily report</td></tr>

    </table>
   </td></tr>
  </table>
  </div>`;
}

export function buildReportText(d: ReportData): string {
  return [
    `Pilars Warm-up — Daily Report (${d.date})`,
    ``,
    `Sent today:     ${d.sentToday}`,
    `Replies today:  ${d.repliesToday}`,
    `Received today: ${d.receivedToday}`,
    `Peers:          ${d.contacts}`,
    `Mailboxes:      ${d.mailboxes} (${d.imapReady} imap-ready)`,
    `14-day sent:    ${d.sent14}`,
    ``,
    `Mailboxes:`,
    ...d.perBox.map((b) => `  ${b.imap ? "•" : "x"} ${b.email} — ${b.target}/day`),
  ].join("\n");
}
