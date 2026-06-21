"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Full navigation so proxy re-evaluates with the new session cookie.
      window.location.href = "/";
    } else {
      setError(true);
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-mark">Kal</div>
        <p className="login-sub">Enter your password to continue.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Password"
            aria-label="Password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={error ? "err" : ""}
          />
          <button type="submit" className="btn-dark" disabled={busy || password === ""}>
            {busy ? "…" : "Enter"}
          </button>
        </form>
        {error && <div className="login-err">Incorrect password.</div>}
      </div>
    </main>
  );
}
