"use client";

import { useState } from "react";

export default function Login() {
  const [user, setUser] = useState("vijay@pilars");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      const j = await r.json();
      if (j.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        window.location.href = next;
      } else {
        setErr(j.error || "login failed");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div className="chrome">
          <div className="dots"><i style={{ background: "#ff5f57" }} /><i style={{ background: "#febc2e" }} /><i style={{ background: "#28c840" }} /></div>
          <div className="chrome-title">pilars warm-up <span className="faint">· sign in</span></div>
        </div>
        <form onSubmit={submit} className="card" style={{ borderRadius: "0 0 12px 12px", borderTop: "none", padding: 22 }}>
          <div className="label" style={{ marginBottom: 6 }}>User</div>
          <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
          <div className="label" style={{ margin: "14px 0 6px" }}>Password</div>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {err && <div style={{ color: "var(--rose)", fontSize: 12, marginTop: 12 }}>{err}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18, justifyContent: "center" }}>
            {busy ? "…" : "SIGN IN"}
          </button>
        </form>
      </div>
    </div>
  );
}
