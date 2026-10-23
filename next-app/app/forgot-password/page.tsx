"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/lib/components/AuthShell";
import s from "@/lib/components/AuthShell.module.css";

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
    <AuthShell
      kicker="Password reset"
      title="Forgot your password?"
      subtitle="Enter the email you sign in with and we'll send you a link to choose a new one."
    >
      {sent ? (
        <div className="note good" role="status">
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
      <p className={s.aside}>
        Remembered it? <Link href="/login" className={s.inlineLink}>Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
