"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status = "verifying" | "ready" | "invalid";
type TokenType = "invite" | "recovery";

// Shared by /accept-invite and /reset-password -- both verify a token_hash
// via verifyOtp() (deliberately not Supabase's redirect-based action_link
// chain, which would depend on this project's PKCE/redirect-URL config in
// ways that are finicky for a link opened in a different browser/session
// than the one it was generated for) and then let the user set a password.
export function VerifyTokenGate({ type, invalidMessage }: { type: TokenType; invalidMessage: string }) {
  return (
    <Suspense>
      <VerifyTokenForm type={type} invalidMessage={invalidMessage} />
    </Suspense>
  );
}

function VerifyTokenForm({ type, invalidMessage }: { type: TokenType; invalidMessage: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    if (!tokenHash) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no async work to do, nothing left to verify
      setStatus("invalid");
      return;
    }
    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => setStatus(error ? "invalid" : "ready"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; token_hash/type don't change after first render
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      return setError("Password must be at least 6 characters.");
    }
    if (password !== confirm) {
      return setError("Passwords don't match.");
    }

    setSaving(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (error) {
      return setError("That didn't work: " + error.message);
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="wrap">
      <div className="gate">
        <div className="panel">
          <div className="panel-head">
            <h2>Set your password</h2>
          </div>
          <div className="panel-body">
            {status === "verifying" ? (
              <div className="empty">Checking your link…</div>
            ) : status === "invalid" ? (
              <div className="note bad">{invalidMessage}</div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error ? <div className="note bad">{error}</div> : null}
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirm">Confirm password</label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <button className="primary" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save password"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
