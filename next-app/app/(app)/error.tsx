"use client";

import { useEffect } from "react";

// One shared boundary for all four views (Board/Docket/Billing/Admin) --
// a genuinely unexpected render error is rare enough that four near-
// identical files isn't worth it for this stage.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="note bad">Something went wrong loading this page.</div>
        <button className="ghost" type="button" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
