"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------------------------------- types --------------------------------- */
interface PerBox { email: string; ageDays: number; target: number; imap: boolean }
interface Stats {
  mailboxes: number; contacts: number; sentToday: number; repliesToday: number;
  receivedToday: number; pendingReplies: number; perBox: PerBox[];
}
interface Activity {
  id: string; direction: "outbound" | "inbound"; is_reply: number;
  from_addr: string; to_addr: string; subject: string; status: string; created_at: string;
}
interface Day { day: string; outbound: number; inbound: number; replies: number }
interface Edge { from: string; to: string; is_reply: number }
interface Payload { ok: boolean; stats: Stats; activity: Activity[]; series: Day[]; edges: Edge[]; error?: string }

/* -------------------------------- helpers --------------------------------- */
const short = (e: string) => e.split("@")[0];
const dom = (e: string) => e.split("@")[1] ?? "";
function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/* ------------------------------- big stat --------------------------------- */
function Big({ label, value, color, caption, capColor }: {
  label: string; value: number | string; color?: string; caption?: string; capColor?: string;
}) {
  return (
    <div className="card" style={{ padding: "20px 22px" }}>
      <div className="label">{label}</div>
      <div className="hero-num" style={{ color: color || "var(--text)", marginTop: 12, fontWeight: 800, fontSize: 56 }}>
        {value}
      </div>
      {caption && <div className="hero-cap" style={{ color: capColor || "var(--muted)" }}>{caption}</div>}
    </div>
  );
}

/* ------------------------------- sparkline (mini) ------------------------- */
function Spark({ data, stroke }: { data: number[]; stroke: string }) {
  const w = 120, h = 26, max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="26" style={{ display: "block", marginTop: 10 }}>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------- network graph ------------------------------- */
function Network({ boxes, edges }: { boxes: PerBox[]; edges: Edge[] }) {
  const size = 400, cx = size / 2, cy = size / 2, R = 145;
  const nodes = useMemo(() => {
    const n = Math.max(1, boxes.length);
    return boxes.map((b, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { ...b, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
  }, [boxes]);
  const pos = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); nodes.forEach((n) => m.set(n.email, { x: n.x, y: n.y })); return m; }, [nodes]);
  const packets = edges.slice(0, 12).map((e, i) => ({ ...e, i })).filter((e) => pos.has(e.from) && pos.has(e.to));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ display: "block" }}>
      {nodes.map((a, i) => nodes.slice(i + 1).map((b, j) => (
        <line key={`m${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      )))}
      {packets.map((e) => {
        const a = pos.get(e.from)!, b = pos.get(e.to)!;
        const path = `M${a.x},${a.y} L${b.x},${b.y}`;
        const color = e.is_reply ? "#5fd08a" : "#ff8a3d";
        const dur = 2 + (e.i % 5) * 0.5;
        return (
          <g key={`p${e.i}`}>
            <path d={path} stroke="rgba(255,255,255,0.07)" strokeWidth={1} fill="none" />
            <circle r={3.4} fill={color}>
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
              <animate attributeName="opacity" values="0;1;1;0" dur={`${dur}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.email}>
          <circle cx={n.x} cy={n.y} r={19} fill="#0c0c0f" stroke={n.imap ? "#5fd08a" : "#3a3a42"} strokeWidth={1.5} />
          {n.imap && (
            <circle cx={n.x} cy={n.y} r={19} fill="none" stroke="#5fd08a" strokeWidth={1}>
              <animate attributeName="r" values="19;25;19" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite" />
            </circle>
          )}
          <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ededf0">{short(n.email).slice(0, 7)}</text>
          <text x={n.x} y={n.y + 33} textAnchor="middle" fontSize={8.5} fill="#55555f">{dom(n.email)}</text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------ ramp chart -------------------------------- */
function RampChart({ series }: { series: Day[] }) {
  const w = 620, h = 180, pad = 20;
  const max = Math.max(1, ...series.map((d) => d.outbound + d.inbound));
  const bw = (w - pad * 2) / Math.max(1, series.length);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}
      {series.map((d, i) => {
        const x = pad + i * bw + bw * 0.2, bwi = bw * 0.6;
        const inH = h - pad - y(d.inbound);
        return (
          <g key={d.day}>
            <rect x={x} y={y(d.outbound)} width={bwi} height={Math.max(0, h - pad - y(d.outbound))} rx={2} fill="#ff8a3d" opacity={0.9} />
            <rect x={x} y={y(d.outbound) - inH} width={bwi} height={Math.max(0, inH)} rx={2} fill="#6ab7ff" opacity={0.75} />
          </g>
        );
      })}
      {series.map((d, i) => i % 2 === 0 ? (
        <text key={d.day} x={pad + i * bw + bw / 2} y={h - 5} textAnchor="middle" fontSize={8.5} fill="#55555f">{d.day.slice(5)}</text>
      ) : null)}
    </svg>
  );
}

function tagFor(a: Activity) {
  if (a.direction === "inbound") return { text: "recv", color: "#6ab7ff" };
  if (a.is_reply) return { text: "reply", color: "#5fd08a" };
  return { text: "sent", color: "#ff8a3d" };
}

/* ================================ PAGE ==================================== */
export default function Page() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const prevIds = useRef<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const [contacts, setContacts] = useState<{ email: string; name: string }[]>([]);
  const [pName, setPName] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [bulk, setBulk] = useState("");
  const [savingPeer, setSavingPeer] = useState(false);
  const [peerMsg, setPeerMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      const j: Payload = await r.json();
      if (!j.ok) { setErr(j.error || "failed to load"); return; }
      setErr(null);
      const fresh = new Set<string>();
      if (prevIds.current.size) for (const a of j.activity) if (!prevIds.current.has(a.id)) fresh.add(a.id);
      prevIds.current = new Set(j.activity.map((a) => a.id));
      if (fresh.size) { setFlashIds(fresh); setTimeout(() => setFlashIds(new Set()), 1400); }
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  const loadContacts = useCallback(async () => {
    try { const r = await fetch("/api/contacts", { cache: "no-store" }); const j = await r.json(); setContacts(j.contacts ?? []); } catch { /* */ }
  }, []);

  useEffect(() => { load(); loadContacts(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load, loadContacts]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const r = await fetch("/api/run", { method: "POST" });
      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch { /* non-JSON (timeout/error page) */ }
      if (j?.ok) {
        setLastRun(`sent ${j.sends?.sent ?? 0} · replied ${j.repliesSent ?? 0} · agentmail ${j.agentmail?.replied ?? 0} · bounced ${j.bounces?.removed ?? 0}`);
      } else if (r.status === 504 || /timeout/i.test(text)) {
        setLastRun("tick timed out (partial run) — retry, or let the daily cron handle it");
      } else {
        setLastRun(`error: ${j?.error || text.slice(0, 80)}`);
      }
      await load(); await loadContacts();
    } catch (e) { setLastRun(`error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setRunning(false); }
  }, [load, loadContacts]);

  const addPeer = useCallback(async () => {
    const email = pEmail.trim();
    if (!email.includes("@")) { setPeerMsg("enter a valid email"); return; }
    setSavingPeer(true); setPeerMsg(null);
    try {
      const r = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: [{ email, name: pName.trim() }] }) });
      const j = await r.json(); setPeerMsg(j.ok ? `added ${j.added}` : `error: ${j.error}`);
      setPName(""); setPEmail(""); await loadContacts(); await load();
    } catch (e) { setPeerMsg(`error: ${e instanceof Error ? e.message : String(e)}`); } finally { setSavingPeer(false); }
  }, [pEmail, pName, loadContacts, load]);

  const addBulk = useCallback(async () => {
    if (!bulk.trim()) return; setSavingPeer(true); setPeerMsg(null);
    try {
      const r = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails: bulk }) });
      const j = await r.json(); setPeerMsg(j.ok ? `added ${j.added} peers` : `error: ${j.error}`);
      setBulk(""); await loadContacts(); await load();
    } catch (e) { setPeerMsg(`error: ${e instanceof Error ? e.message : String(e)}`); } finally { setSavingPeer(false); }
  }, [bulk, loadContacts, load]);

  const removePeer = useCallback(async (email: string) => {
    await fetch(`/api/contacts?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    await loadContacts(); await load();
  }, [loadContacts, load]);

  const s = data?.stats;
  const series = data?.series ?? [];
  const imapReady = s?.perBox.filter((b) => b.imap).length ?? 0;

  // pipeline status checklist (data-driven ✓ △ ○)
  const steps: { on: boolean; warn?: boolean; label: string; pill: string }[] = [
    { on: true, label: "AgentMail inbox connected", pill: "done" },
    { on: true, label: "Groq auto-reply (llama-3.3-70b)", pill: "done" },
    { on: (s?.contacts ?? 0) > 0, label: `Peers loaded${s ? ` · ${s.contacts}` : ""}`, pill: (s?.contacts ?? 0) > 0 ? "done" : "idle" },
    { on: imapReady > 0, warn: imapReady === 0, label: imapReady > 0 ? `Zoho SMTP send · ${imapReady}/${s?.mailboxes ?? 0}` : "Zoho SMTP send · needs app passwords", pill: imapReady > 0 ? "done" : "running" },
    { on: imapReady > 0, warn: imapReady === 0, label: "Bounce guard (auto-remove dead peers)", pill: imapReady > 0 ? "done" : "idle" },
  ];

  return (
    <div className="wrap">
      {/* window chrome */}
      <div className="chrome">
        <div className="dots"><i style={{ background: "#ff5f57" }} /><i style={{ background: "#febc2e" }} /><i style={{ background: "#28c840" }} /></div>
        <div className="chrome-title">pilars warm-up <span className="faint">· daily run</span></div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`pill ${err ? "idle" : "done"}`}><span className={`d ${err ? "" : "pulse"}`} />{err ? "OFFLINE" : "LIVE"}</span>
          <button className="btn" onClick={runNow} disabled={running}>
            {running ? <span className="spin">◍</span> : "▶"} {running ? "RUNNING" : "RUN TICK"}
          </button>
          <button className="btn ghost sm" disabled={running} onClick={async () => {
            if (!confirm("Send one email from all domains to every peer now?")) return;
            setRunning(true);
            try { const r = await fetch("/api/send-all", { method: "POST" }); const j = await r.json();
              setLastRun(j.ok ? `blast · sent ${j.sent}/${j.total}${j.errors ? ` · ${j.errors} failed` : ""}` : `error: ${j.error}`);
              await load();
            } finally { setRunning(false); }
          }}>SEND ALL</button>
          <button className="btn ghost sm" disabled={running} onClick={async () => {
            setRunning(true);
            try { const r = await fetch("/api/report", { method: "POST" }); const j = await r.json();
              setLastRun(j.ok ? `report sent · ${j.sent} emails from ${j.from?.length} domains to ${j.recipients?.length} recipients` : `report error: ${j.error}`);
            } finally { setRunning(false); }
          }}>EMAIL REPORT</button>
          <button className="btn ghost sm" onClick={async () => { await fetch("/api/auth/login", { method: "DELETE" }); window.location.href = "/login"; }}>
            SIGN OUT
          </button>
        </div>
      </div>

      {/* prompt strip */}
      <div className="prompt">
        <span className="caret">›</span>
        Warm up <b>4 domains</b> to <b>{s?.contacts ?? "—"} peers</b> daily — send via Zoho SMTP, auto-reply via <b>AgentMail + Groq</b>.
      </div>

      {lastRun && (
        <div className="card" style={{ padding: "11px 16px", marginBottom: 16, fontSize: 12.5 }}>
          <span className="muted">last tick › </span><span style={{ color: "var(--orange)" }}>{lastRun}</span>
        </div>
      )}
      {err && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "rgba(255,107,107,0.4)" }}>
          <div style={{ color: "var(--rose)", fontSize: 13 }}>{err}</div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>check TURSO_* env and that mailboxes are seeded.</div>
        </div>
      )}

      {/* BIG hero numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        <Big label="Sent · today" value={s?.sentToday ?? "—"} color="var(--orange)" caption="to peers" capColor="var(--amber)" />
        <Big label="Replies · today" value={s?.repliesToday ?? "—"} color="var(--green)" caption="auto-answered" capColor="var(--green)" />
        <Big label="Received · today" value={s?.receivedToday ?? "—"} color="var(--blue)" caption="peer replies" />
        <Big label="Peers" value={s?.contacts ?? "—"} caption="active recipients" />
        <Big label="Mailboxes" value={s?.mailboxes ?? "—"} caption={`${imapReady} imap live`} capColor={imapReady ? "var(--green)" : "var(--amber)"} />
      </div>

      {/* pipeline status + network */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 16 }}>
        <div className="card accent" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="h-title">Pipeline status</div>
            <span className={`pill ${imapReady > 0 ? "done" : "running"}`}>
              <span className="d" />{imapReady > 0 ? "READY" : "SEND PENDING"}
            </span>
          </div>
          {steps.map((st, i) => (
            <div key={i} className={`check ${st.warn ? "warn" : st.on ? "ok" : "idle"}`}>
              <span className="ico">{st.on ? "✓" : st.warn ? "△" : "○"}</span>
              <span style={{ flex: 1 }}>{st.label}</span>
              <span className={`pill ${st.pill}`} style={{ fontSize: 9.5, padding: "2px 7px" }}>
                {st.pill === "done" ? "done" : st.pill === "running" ? "pending" : "idle"}
              </span>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div className="h-title">Send network</div>
            <span className="label" style={{ color: "var(--faint)" }}>
              <span style={{ color: "#ff8a3d" }}>●</span> opener &nbsp; <span style={{ color: "#5fd08a" }}>●</span> reply
            </span>
          </div>
          {data && <Network boxes={s!.perBox} edges={data.edges} />}
        </div>
      </div>

      {/* volume + ramp */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="h-title" style={{ marginBottom: 2 }}>14-day volume</div>
        <div className="label" style={{ color: "var(--faint)", marginBottom: 8 }}>
          <span style={{ color: "#ff8a3d" }}>■</span> outbound &nbsp; <span style={{ color: "#6ab7ff" }}>■</span> inbound
        </div>
        <RampChart series={series} />
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          {s?.perBox.map((b) => {
            const pct = Math.min(100, (b.target / 40) * 100);
            return (
              <div key={b.email}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 5 }}>
                  <span style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <span className="dot" style={{ background: b.imap ? "#5fd08a" : "#ff6b6b" }} />{b.email}
                  </span>
                  <span className="muted">{b.target}/d · d{b.ageDays}</span>
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* peers */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="h-title">Peers · contacts</div>
          <span className="label" style={{ color: "var(--muted)" }}>{contacts.length} loaded</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 12 }}>
          <input className="input" placeholder="NAME (optional)" value={pName} onChange={(e) => setPName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPeer()} />
          <input className="input" placeholder="colleague@company.com" value={pEmail} onChange={(e) => setPEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPeer()} />
          <button className="btn sm" onClick={addPeer} disabled={savingPeer}>ADD PEER</button>
        </div>
        <textarea className="textarea" placeholder="bulk paste — emails separated by comma, space, or newline" value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: peerMsg?.startsWith("error") ? "var(--rose)" : "var(--green)" }}>{peerMsg ?? ""}</span>
          <button className="btn ghost sm" onClick={addBulk} disabled={savingPeer || !bulk.trim()}>IMPORT LIST</button>
        </div>
        {contacts.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 240, overflowY: "auto", borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
            {contacts.map((c) => (
              <div key={c.email} className="peer-row">
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#ededf0" }}>{c.name || short(c.email)}</span><span className="faint"> · </span>
                  <span style={{ color: "var(--orange)" }}>{c.email}</span>
                </span>
                <button className="xbtn" onClick={() => removePeer(c.email)}>REMOVE</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* activity */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="h-title">Activity log</div>
          <span className="label" style={{ color: "var(--faint)" }}>auto-refresh · 8s</span>
        </div>
        {data?.activity.map((a) => {
          const t = tagFor(a);
          return (
            <div key={a.id} className={`feed-row ${flashIds.has(a.id) ? "flash" : ""}`}>
              <span className="tag" style={{ color: t.color, borderColor: t.color + "55" }}>{t.text}</span>
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--orange)" }}>{short(a.from_addr)}</span><span className="faint"> → </span>
                <span style={{ color: "#ededf0" }}>{short(a.to_addr)}</span><span className="faint"> · </span>
                <span className="muted">{a.subject || "(no subject)"}</span>
              </span>
              <span className="faint" style={{ fontSize: 11 }}>{timeAgo(a.created_at)}</span>
            </div>
          );
        })}
        {(!data || data.activity.length === 0) && (
          <p className="muted" style={{ fontSize: 12.5 }}>no activity yet — hit RUN TICK once mailboxes have creds.</p>
        )}
      </div>
    </div>
  );
}
