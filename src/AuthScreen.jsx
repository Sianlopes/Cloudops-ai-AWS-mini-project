import React, { useState } from "react";
import { Cloud, LockKeyhole, ArrowRight, ShieldCheck } from "lucide-react";
export default function AuthScreen({ setupRequired, api, onSuccess }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">
          <Cloud size={23} />
        </span>
        cloudops <span className="ai-label">AI</span>
      </div>
      <section className="auth-card">
        <span className="auth-icon">
          <LockKeyhole size={24} />
        </span>
        <h1>{setupRequired ? "Set up your workspace" : "Welcome back"}</h1>
        <p>
          {setupRequired
            ? "Create your administrator account to start monitoring."
            : "Sign in to your cloud operations workspace."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const result = await api(
                `auth/${setupRequired ? "setup" : "login"}`,
                { body: Object.fromEntries(new FormData(e.currentTarget)) },
              );
              onSuccess(result);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Email address
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
              maxLength={254}
            />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              autoComplete={setupRequired ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={128}
            />
            <span className="form-hint">
              {setupRequired
                ? "Use at least 12 characters. No default password is provided."
                : "Use your administrator password."}
            </span>
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary auth-submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : setupRequired
                ? "Create workspace"
                : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="auth-footer">
          <ShieldCheck size={15} />
          Secure sessions · private workspace
        </div>
      </section>
      <p className="auth-caption">Clarity for your cloud operations.</p>
    </div>
  );
}
