"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { m2, lab, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import { estimateTripCost, type CostTemplateLine, type CostEstimate } from "@/lib/estimates/estimateTripCost";
import type { BootstrapPayload, Customer, Route } from "@/lib/types";

const NEEDS_LABEL: Record<string, string> = {
  tonnage: "enter tonnage",
  volume: "enter volume",
  distance: "route has no distance set",
};

export default function EstimatesPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [routeId, setRouteId] = useState("");
  const [borderPathId, setBorderPathId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [tonnage, setTonnage] = useState("");
  const [volumeCbm, setVolumeCbm] = useState("");
  const [printing, setPrinting] = useState(false);

  async function load() {
    const res = await fetch("/api/bootstrap");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setLoadError("Couldn't load — try refreshing.");
      return;
    }
    const payload: BootstrapPayload = await res.json();
    setData(payload);
    setLoadError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
    if (payload.routes.length) setRouteId((cur) => cur || payload.routes[0].id);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load is recreated every render
  }, []);

  useEffect(() => {
    if (printing) window.print();
  }, [printing]);

  if (!data) return <div className="panel"><Spinner /></div>;

  const activeRoutes = data.routes.filter((r) => r.is_active !== false);
  const route = data.routes.find((r) => r.id === routeId) ?? null;
  const pathsForRoute = data.routeBorderPaths.filter((p) => p.route_id === routeId);
  const chosenPath = data.routeBorderPaths.find((p) => p.id === borderPathId);
  const borderList = chosenPath ? chosenPath.borders : route?.borders ?? null;
  const borderLabel = chosenPath ? chosenPath.label : "Default";

  const tonnageNum = parseFloat(tonnage);
  const volumeNum = parseFloat(volumeCbm);
  const quantities = {
    distanceKm: route?.distance_km ?? null,
    tonnage: Number.isFinite(tonnageNum) && tonnageNum > 0 ? tonnageNum : null,
    volumeCbm: Number.isFinite(volumeNum) && volumeNum > 0 ? volumeNum : null,
  };

  const templateLines: CostTemplateLine[] = data.routeCostTemplates
    .filter((l) => l.route_id === routeId)
    .map((l) => ({ category: l.category, amount: l.amount, currency: l.currency, basis: l.basis }));
  const estimate = estimateTripCost(templateLines, quantities);

  const customer = data.customers.find((c) => c.id === customerId) ?? null;
  const matchedRate = customerId
    ? data.rateCards.find((r) => r.route_id === routeId && (r.customer_id === customerId || !r.customer_id))
    : null;
  const revenueEstimate: CostEstimate | null = matchedRate
    ? estimateTripCost(
        [{ category: "revenue", amount: matchedRate.rate_amount, currency: matchedRate.rate_currency, basis: matchedRate.rate_basis as CostTemplateLine["basis"] }],
        quantities,
      )
    : null;
  const revenueAmount = revenueEstimate && !revenueEstimate.incomplete ? revenueEstimate.total : null;
  const margin = revenueAmount !== null ? revenueAmount - estimate.total : null;

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Estimate</h2>
            {route ? <button className="act" type="button" onClick={() => setPrinting(true)}>Print / PDF</button> : null}
          </div>
          {!route ? (
            <div className="empty">Pick a route to see an estimate.</div>
          ) : (
            <div className="panel-body">
              {!templateLines.length ? (
                <div className="d-hint" style={{ marginBottom: matchedRate ? 16 : 0 }}>
                  No cost template configured for this route yet — add one under Admin → Routes.
                </div>
              ) : (
                <>
                  <ul className="list" style={{ marginBottom: 13 }}>
                    {estimate.lines.map((l) => (
                      <li key={l.category}>
                        <div>
                          <div className="r-no" style={{ color: "var(--stamp)" }}>{lab(l.category)}</div>
                          <div className="r-mono">
                            {m2(l.rate)} {l.basis === "per_trip" ? "flat" : l.basis === "per_tonne" ? "/ tonne" : l.basis === "per_cbm" ? "/ m³" : "/ km"}
                          </div>
                        </div>
                        <div className="r-right">
                          {l.amount !== null ? (
                            <div className="r-amt">{m2(l.amount)}</div>
                          ) : (
                            <div className="r-min" style={{ color: "var(--waiting)" }}>{NEEDS_LABEL[l.needsInput ?? ""]}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="d-kv" style={{ fontWeight: 700, fontSize: 14.5, borderTop: "2px solid var(--ink)", paddingTop: 10 }}>
                    <span>Estimated total cost</span><span>{m2(estimate.total)}</span>
                  </div>
                  {estimate.incomplete ? (
                    <div className="d-hint" style={{ marginTop: 6 }}>Enter the missing quantities above to complete the estimate.</div>
                  ) : null}
                </>
              )}
              {matchedRate ? (
                <div className="d-sec" style={{ marginTop: templateLines.length ? 16 : 0, paddingLeft: 0, paddingRight: 0, borderBottom: "none" }}>
                  <h3>vs. {customer?.name}</h3>
                  <div className="d-kv"><span>Estimated revenue</span><span>{revenueAmount !== null ? m2(revenueAmount) : "—"}</span></div>
                  {margin !== null ? (
                    <div className="d-kv" style={{ fontWeight: 600 }}>
                      <span>Estimated margin</span>
                      <span style={{ color: margin >= 0 ? "var(--settled)" : "var(--alert)" }}>{m2(margin)}</span>
                    </div>
                  ) : null}
                </div>
              ) : customerId ? (
                <div className="d-hint" style={{ marginTop: templateLines.length ? 16 : 0 }}>
                  No rate card on file for this customer and route.
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Trip details</h2></div>
          <div className="panel-body">
            <div className="field">
              <label htmlFor="eRoute">Route</label>
              <select id="eRoute" value={routeId} onChange={(e) => { setRouteId(e.target.value); setBorderPathId(""); }}>
                {activeRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {pathsForRoute.length ? (
              <div className="field">
                <label htmlFor="eBorderPath">Border route</label>
                <select id="eBorderPath" value={borderPathId} onChange={(e) => setBorderPathId(e.target.value)}>
                  <option value="">Default ({(route?.borders || []).join(" → ") || "route's own path"})</option>
                  {pathsForRoute.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.borders.join(" → ")})</option>)}
                </select>
                <div className="hint">Only labels the estimate — every path uses the same cost template.</div>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="eCustomer">Customer (optional)</label>
              <select id="eCustomer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— none —</option>
                {data.customers.filter((c) => c.is_active !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="hint">Shows an estimated revenue/margin if a rate card matches this customer and route.</div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="eTon">Tonnage</label>
                <input id="eTon" type="number" step="0.001" min="0" placeholder="28.500" value={tonnage} onChange={(e) => setTonnage(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="eVol">Volume (m³)</label>
                <input id="eVol" type="number" step="0.001" min="0" placeholder="e.g. for tankers/tippers" value={volumeCbm} onChange={(e) => setVolumeCbm(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {printing && route ? (
        <EstimatePrintSheet
          route={route}
          borderLabel={borderLabel}
          borderList={borderList}
          customer={customer}
          estimate={estimate}
          revenueAmount={revenueAmount}
          margin={margin}
          onDone={() => setPrinting(false)}
        />
      ) : null}
    </>
  );
}

function EstimatePrintSheet({
  route,
  borderLabel,
  borderList,
  customer,
  estimate,
  revenueAmount,
  margin,
  onDone,
}: {
  route: Route;
  borderLabel: string;
  borderList: string[] | null;
  customer: Customer | null;
  estimate: CostEstimate;
  revenueAmount: number | null;
  margin: number | null;
  onDone: () => void;
}) {
  useEffect(() => {
    const handler = () => onDone();
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, [onDone]);

  return createPortal(
    <div id="sheet">
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">Cost Estimate</div>
          {route.name}<br />Printed {today()}
        </div>
      </div>
      <div className="parties">
        <div>
          <h4>Route</h4>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{route.name}</div>
          <div style={{ fontSize: 11.5, color: "#444" }}>
            {route.origin} → {route.destination}<br />
            {route.distance_km ? <>{route.distance_km} km<br /></> : null}
            {borderList?.length ? <>Via {borderLabel === "Default" ? "" : borderLabel + " — "}{borderList.join(" → ")}</> : null}
          </div>
        </div>
        {customer ? (
          <div style={{ textAlign: "right" }}>
            <h4>Customer</h4>
            <div style={{ fontSize: 13 }}>{customer.name}</div>
          </div>
        ) : null}
      </div>
      <table>
        <thead><tr><th>Cost category</th><th>Basis</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {estimate.lines.map((l) => (
            <tr key={l.category}>
              <td>{lab(l.category)}</td>
              <td>{m2(l.rate)} {l.basis === "per_trip" ? "flat" : l.basis === "per_tonne" ? "/ tonne" : l.basis === "per_cbm" ? "/ m³" : "/ km"}</td>
              <td className="num">{l.amount !== null ? m2(l.amount) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div className="due"><span>Estimated total cost</span><span>{m2(estimate.total)}</span></div>
        {revenueAmount !== null ? <div><span>Estimated revenue</span><span>{m2(revenueAmount)}</span></div> : null}
        {margin !== null ? <div><span>Estimated margin</span><span>{m2(margin)}</span></div> : null}
      </div>
      <div className="terms">
        This is an estimate only, based on configured cost/rate templates — actual trip costs and revenue may differ.
      </div>
    </div>,
    document.body,
  );
}
