"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BootstrapPayload } from "@/lib/types";

const VIEWS = [
  { href: "/board", label: "Board", short: "Board" },
  { href: "/docket", label: "Cost docket", short: "Docket" },
  { href: "/billing", label: "Billing", short: "Billing" },
  { href: "/admin", label: "Admin", short: "Admin" },
];

// Ported from renderNav()/renderWarn() (index.html) -- one shared fetch for
// both the per-tab counts and the stale-FX-rate check, since both need the
// same bootstrap payload and neither is worth a dedicated endpoint.
export function Nav() {
  const pathname = usePathname();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/bootstrap")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: BootstrapPayload | null) => {
        setData(payload);
        setFetchedAt(Date.now());
      });
  }, []);

  const rolling = data?.board.filter((t) => ["loading", "in_transit", "at_border"].includes(t.status)).length ?? 0;
  const pod = data?.board.filter((t) => t.status === "delivered" && !t.pod_in_hand).length ?? 0;
  const overdue = data?.ar.filter((i) => i.days_overdue > 0).length ?? 0;
  const billing = (data?.billable.length ?? 0) + overdue;

  const counts: Record<string, [number, boolean]> = {
    "/board": [rolling, false],
    "/docket": [pod, pod > 0],
    "/billing": [billing, overdue > 0],
    "/admin": [0, false],
  };

  // Most recent fx_rates row per non-USD currency, flagged if over 14 days old.
  const latest: Record<string, string> = {};
  (data?.fx ?? []).forEach((r) => {
    if (r.currency === "USD") return;
    if (!latest[r.currency] || r.effective_on > latest[r.currency]) latest[r.currency] = r.effective_on;
  });
  const staleDays = (d: string) => ((fetchedAt ?? 0) - new Date(d).getTime()) / 86_400_000;
  const stale = fetchedAt ? Object.entries(latest).filter(([, d]) => staleDays(d) > 14) : [];

  return (
    <>
      <nav className="nav-top">
        {VIEWS.map((v) => {
          const on = pathname === v.href || pathname.startsWith(v.href + "/");
          const [count, alert] = counts[v.href] ?? [0, false];
          return (
            <Link key={v.href} href={v.href} className={on ? "on" : undefined}>
              {v.label}
              {count > 0 ? <span className={"n" + (alert ? " alert" : "")}>{count}</span> : null}
            </Link>
          );
        })}
      </nav>
      <nav className="nav-mobile">
        {VIEWS.map((v) => {
          const on = pathname === v.href || pathname.startsWith(v.href + "/");
          const [count, alert] = counts[v.href] ?? [0, false];
          return (
            <Link key={v.href} href={v.href} className={on ? "on" : undefined}>
              {v.short}
              {count > 0 ? <span className={"n" + (alert ? " alert" : "")}>{count}</span> : null}
            </Link>
          );
        })}
      </nav>
      {stale.length ? (
        <div className="note warn">
          Exchange rates for {stale.map(([c]) => c).join(", ")} are more than two weeks old. Every cost entered
          today converts at those rates. <Link href="/admin" style={{ color: "inherit" }}>Update them</Link>.
        </div>
      ) : null}
    </>
  );
}
