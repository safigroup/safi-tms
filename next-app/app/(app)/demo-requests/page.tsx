"use client";

import { useEffect, useState } from "react";
import type { DemoRequest } from "@/lib/types";
import { DEMO_COUNTRIES, DEMO_FLEET_SIZES } from "@/lib/demoRequests/options";
import { Spinner } from "@/lib/components/Spinner";

const countryName = (code: string | null) => DEMO_COUNTRIES.find((c) => c.code === code)?.en ?? null;
const fleetLabel = (code: string | null) => DEMO_FLEET_SIZES.find((f) => f.code === code)?.en ?? null;

export default function DemoRequestsPage() {
  const [requests, setRequests] = useState<DemoRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform/demo-requests").then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setLoadError(body.error || res.statusText);
      setRequests(body.requests);
    });
  }, []);

  if (loadError) return <div className="note bad">{loadError}</div>;
  if (!requests) return <div className="panel"><Spinner /></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Demo requests</h2>
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
  );
}
