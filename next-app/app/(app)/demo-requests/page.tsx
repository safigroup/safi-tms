"use client";

import { useEffect, useState } from "react";
import type { DemoRequest } from "@/lib/types";
import { DEMO_COUNTRIES, DEMO_FLEET_SIZES } from "@/lib/demoRequests/options";
import { Spinner } from "@/lib/components/Spinner";
import { PageBand } from "@/lib/components/PageBand";

const countryName = (code: string | null) => DEMO_COUNTRIES.find((c) => c.code === code)?.en ?? null;
const fleetLabel = (code: string | null) => DEMO_FLEET_SIZES.find((f) => f.code === code)?.en ?? null;

export default function DemoRequestsPage() {
  const [requests, setRequests] = useState<DemoRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    fetch("/api/platform/demo-requests").then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setLoadError(body.error || res.statusText);
      setRequests(body.requests);
      setLoadedAt(Date.now());
    });
  }, []);

  if (loadError) return <div className="note bad">{loadError}</div>;
  if (!requests) return <div className="panel"><Spinner /></div>;

  // Counted back from when the list loaded -- just a rough "how busy lately".
  const within = (days: number) => requests.filter((r) => loadedAt - new Date(r.created_at).getTime() <= days * 86_400_000).length;
  const week = within(7);
  const month = within(30);

  return (
    <>
    <PageBand
      kicker="Platform"
      title={`${requests.length} demo request${requests.length === 1 ? "" : "s"}`}
      sub="Sent from the form on the landing page."
      figs={[
        { key: "week", k: "Last 7 days", v: week, tone: week ? "pos" : undefined },
        { key: "month", k: "Last 30 days", v: month },
        { key: "all", k: "All time", v: requests.length },
      ]}
    />
    <div className="panel">
      <div className="panel-head">
        <h2>Requests</h2>
        <span className="r-min">{requests.length} from the landing page</span>
      </div>
      <ul className="list" style={{ maxHeight: "none" }}>
        {requests.length ? requests.map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <div className="r-no">
              {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </div>
            <div className="r-title">{r.company}</div>
            <div className="r-sub">
              {[r.name, countryName(r.country), fleetLabel(r.fleet_size)].filter(Boolean).join(" · ")}
            </div>
            <div className="r-mono">
              {r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : null}
              {r.email && r.phone ? " · " : null}
              {r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : null}
            </div>
            {r.message ? (
              <div className="r-sub" style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{r.message}</div>
            ) : null}
            <div className="r-tags">
              <span className="pill grey">{r.lang === "fr" ? "Sent in French" : "Sent in English"}</span>
            </div>
          </li>
        )) : <li className="empty">No demo requests yet.</li>}
      </ul>
    </div>
    </>
  );
}
