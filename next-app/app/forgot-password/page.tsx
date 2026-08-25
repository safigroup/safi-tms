"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    // Always shows the same outcome regardless of whether the email is
    // registered -- resetPasswordForEmail() itself doesn't reveal that,
    // and the UI must not either.
    await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSending(false);
    setSent(true);
  }

  return (
    <div className="wrap">
      <div className="gate">
        <div className="panel">
          <div className="panel-head">
            <h2>Reset your password</h2>
          </div>
          <div className="panel-body">
            {sent ? (
              <div className="note good">
                If that email has an account, we&apos;ve sent a link to reset the password. It may take a minute to arrive.
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button className="primary" type="submit" disabled={sending}>
                  {sending ? "Sending…" : "Send reset link"}
                </button>
              </form>
            )}
            <Link href="/login" style={{ display: "block", marginTop: 12, fontSize: 13, color: "var(--ink-soft)" }}>
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
