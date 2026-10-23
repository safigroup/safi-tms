"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/lib/components/AuthShell";
import s from "@/lib/components/AuthShell.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("That didn't work: " + error.message);
      setSigningIn(false);
      return;
    }

    router.replace("/board");
    router.refresh();
  }

  return (
    <AuthShell kicker="Sign in" title="Welcome back" subtitle="Sign in to your company's Safi TMS workspace.">
      {error ? <div className="note bad" role="alert">{error}</div> : null}
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
        <div className="field">
          <div className={s.labelRow}>
            <label htmlFor="password">Password</label>
            <Link href="/forgot-password" className={s.inlineLink}>Forgot password?</Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={signingIn}>
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className={s.aside}>
        New to Safi TMS? <Link href="/#demo" className={s.inlineLink}>Request a demo</Link>
      </p>
    </AuthShell>
  );
}
