"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="wrap">
      <div className="gate">
        <div className="panel">
          <div className="panel-head">
            <h2>Sign in</h2>
          </div>
          <div className="panel-body">
            {error ? <div className="note bad">{error}</div> : null}
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
                <label htmlFor="password">Password</label>
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
            <Link href="/forgot-password" style={{ display: "block", marginTop: 12, fontSize: 13, color: "var(--ink-soft)" }}>
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
