"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, today } from "@/lib/format";
import { useBusyGroup } from "@/lib/useBusyGroup";
import { Spinner } from "@/lib/components/Spinner";
import type { AuditLogEntry, BoardTrip, BootstrapPayload, TripStatus } from "@/lib/types";

const PILL: Record<string, string> = {
  draft: "grey",
  allocated: "grey",
  loading: "violet",
  in_transit: "violet",
  at_border: "warn",
  delivered: "warn",
  pod_received: "good",
  invoiced: "good",
  closed: "grey",
};

const FILTERS: [string, string, (t: BoardTrip) => boolean][] = [
  ["active", "Active", (t) => !["closed", "invoiced"].includes(t.status)],
  ["rolling", "Rolling", (t) => ["loading", "in_transit", "at_border"].includes(t.status)],
  ["border", "At border", (t) => t.status === "at_border"],
  ["pod", "Awaiting POD", (t) => t.status === "delivered" && !t.pod_in_hand],
  ["billable", "Billable", (t) => t.status === "pod_received"],
  ["late", "Late", (t) => !!t.over_target],
  ["all", "All", () => true],
];

const NEXT: Record<string, [TripStatus, string][]> = {
  draft: [["allocated", "Allocate truck"]],
  allocated: [["loading", "Start loading"]],
  loading: [["in_transit", "Depart"]],
  in_transit: [["delivered", "Mark delivered"]],
  at_border: [],
  delivered: [],
  pod_received: [["invoiced", "Mark invoiced"]],
  invoiced: [["closed", "Close trip"]],
};

const lab = (s: string) => s.replace(/_/g, " ");

// Mirrors lib/auth/permissions.ts's CAN_MANAGE_TRIPS/CAN_OVERRIDE_RECORDS --
// UI convenience only (hides actions a role can't use), the route handlers
// are the real check.
const CAN_MANAGE_TRIPS = ["owner", "admin", "ops"];
const CAN_OVERRIDE_RECORDS = ["owner", "admin"];

export default function BoardPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [showNewTrip, setShowNewTrip] = useState(false);

  async function load() {
    const res = await fetch("/api/bootstrap");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Couldn't load — try refreshing.");
      return;
    }
    const payload: BootstrapPayload = await res.json();
    setData(payload);
    setError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
  }

  useEffect(() => {
    // load() is also called after mutations (create/advance/border event),
    // so it has to stay a shared function rather than get inlined here --
    // wrapping it in useCallback just to satisfy exhaustive-deps would
    // re-run this effect every render, since router itself is a new
    // reference each time.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, no cascading-render risk
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load is recreated every render, adding it here would refetch on every render too
  }, []);

  if (!data) return <div className="panel"><Spinner /></div>;

  const board = data.board;
  const rolling = board.filter((t) => ["loading", "in_transit", "at_border"].includes(t.status));
  const late = rolling.filter((t) => t.over_target);
  const pod = board.filter((t) => t.status === "delivered" && !t.pod_in_hand);
  const unbilled = pod.reduce((s, t) => s + Number(t.revenue_usd || 0) * 0.5, 0);
  const done = board.filter((t) => ["pod_received", "invoiced", "closed"].includes(t.status));
  const avg = done.length ? done.reduce((s, t) => s + Number(t.margin_pct || 0), 0) / done.length : null;

  const filterFn = FILTERS.find((f) => f[0] === filter)![2];
  const rows = board.filter(filterFn);
  const selectedTrip = board.find((t) => t.trip_id === selected) || null;
  const canWrite = CAN_MANAGE_TRIPS.includes(data.role);

  return (
    <>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="strip">
        <div className="cell">
          <div className="k">On the road</div>
          <div className="v">{rolling.length}</div>
          <div className="n">{board.filter((t) => t.status !== "closed").length} open trips</div>
        </div>
        <div className="cell">
          <div className="k">Over corridor target</div>
          <div className={"v" + (late.length ? " warn" : "")}>{late.length}</div>
          <div className="n">{late.length ? late.map((t) => t.trip_no).join(", ") : "all on schedule"}</div>
        </div>
        <div className="cell">
          <div className="k">Awaiting POD</div>
          <div className={"v" + (pod.length ? " warn" : "")}>{pod.length}</div>
          <div className="n">{m0(unbilled)} not yet billable</div>
        </div>
        <div className="cell">
          <div className="k">Avg margin, delivered</div>
          <div className={"v" + (avg !== null && avg >= 0 ? " pos" : "")}>
            {avg !== null ? avg.toFixed(1) + "%" : "—"}
          </div>
          <div className="n">{done.length} trips</div>
        </div>
      </div>
      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Trips</h2>
            {canWrite ? (
              <button className="act" onClick={() => { setShowNewTrip(true); setSelected(null); }}>
                + New trip
              </button>
            ) : null}
          </div>
          <div className="chips">
            {FILTERS.map(([key, label, fn]) => (
              <button
                key={key}
                className={"chip" + (filter === key ? " on" : "")}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="c">{board.filter(fn).length}</span>
              </button>
            ))}
          </div>
          <ul className="list">
            {rows.length ? (
              rows.map((t) => {
                const m = Number(t.margin_usd || 0);
                return (
                  <li
                    key={t.trip_id}
                    className={"tap" + (selected === t.trip_id ? " sel" : "")}
                    onClick={() => { setSelected(t.trip_id); setShowNewTrip(false); }}
                  >
                    <div>
                      <div className="r-no">{t.trip_no}</div>
                      <div className="r-title">{t.customer}</div>
                      <div className="r-sub">
                        {t.route}
                        {t.fleet_no ? " · " + t.fleet_no : ""}
                        {t.driver ? " · " + t.driver : ""}
                      </div>
                      <div className="r-tags">
                        <span className={"pill " + (PILL[t.status] || "grey")}>{lab(t.status)}</span>
                        {t.over_target ? (
                          <span className="pill bad">day {t.days_running} of {t.target_days}</span>
                        ) : t.days_running != null ? (
                          <span className="pill grey">day {t.days_running}</span>
                        ) : null}
                        {t.last_border && ["in_transit", "at_border"].includes(t.status) ? (
                          <span className="pill violet">{t.last_border}</span>
                        ) : null}
                        {t.docs_pending ? (
                          <span className="pill warn">{t.docs_pending} doc{t.docs_pending > 1 ? "s" : ""}</span>
                        ) : null}
                        {t.status === "delivered" && !t.pod_in_hand ? (
                          <span className="pill warn">no POD</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="r-right">
                      <div className={"r-amt " + (m >= 0 ? "pos" : "neg")}>{m0(m)}</div>
                      <div className="r-min">{t.margin_pct != null ? t.margin_pct + "%" : "—"}</div>
                      <div className="r-min">{t.cost_entries} costs</div>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="empty">Nothing here.</li>
            )}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>{showNewTrip ? "New trip" : "Trip detail"}</h2>
          </div>
          {showNewTrip ? (
            <NewTripForm
              data={data}
              onCancel={() => setShowNewTrip(false)}
              onCreated={async (tripId) => {
                setShowNewTrip(false);
                await load();
                setSelected(tripId);
              }}
            />
          ) : selectedTrip ? (
            <TripDetail trip={selectedTrip} data={data} onChanged={load} canWrite={canWrite} />
          ) : (
            <div className="empty">Select a trip, or start a new one.</div>
          )}
        </div>
      </div>
    </>
  );
}

function TripDetail({
  trip,
  data,
  onChanged,
  canWrite,
}: {
  trip: BoardTrip;
  data: BootstrapPayload;
  onChanged: () => Promise<void>;
  canWrite: boolean;
}) {
  const { busy, run } = useBusyGroup();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const canOverride = CAN_OVERRIDE_RECORDS.includes(data.role);
  const m = Number(trip.margin_usd || 0);
  const nexts = NEXT[trip.status] || [];
  const canBorder = ["in_transit", "at_border"].includes(trip.status);
  const borders = trip.borders || [];
  const canBill =
    (!trip.pod_in_hand && trip.status === "delivered") ||
    ["pod_received", "in_transit", "at_border", "loading"].includes(trip.status);

  async function advance(status: TripStatus) {
    setNote(null);
    await run(async () => {
      const res = await fetch(`/api/trips/${trip.trip_id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNote("Couldn't update: " + (body.error || res.statusText));
        return;
      }
      toast.success(`Status updated to ${lab(status)}`);
      await onChanged();
    });
  }

  async function borderEvent(kind: "arrival" | "cleared", location: string) {
    setNote(null);
    await run(async () => {
      const res = await fetch("/api/border-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: trip.trip_id, kind, location }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNote("Couldn't log it: " + (body.error || res.statusText));
        return;
      }
      const place = location.split("/")[0];
      toast.success(kind === "arrival" ? `Arrived ${place}` : `Cleared ${place}`);
      await onChanged();
    });
  }

  return (
    <>
      <div className="d-head">
        <div className="r-no">
          {trip.trip_no} · <span className={"pill " + (PILL[trip.status] || "grey")}>{lab(trip.status)}</span>
        </div>
        <div className="r-title" style={{ fontSize: 18 }}>{trip.customer}</div>
        <div className="r-sub">{trip.route}</div>
        <div className="d-figs">
          <div><div className="k">Revenue</div><div className="v">{m2(trip.revenue_usd)}</div></div>
          <div><div className="k">Costs</div><div className="v">{m2(trip.cost_usd)}</div></div>
          <div><div className="k">Margin</div><div className={"v " + (m >= 0 ? "pos" : "neg")}>{m2(m)}</div></div>
        </div>
      </div>
      {editing ? (
        <TripEditForm
          trip={trip}
          data={data}
          onSaved={async () => { setEditing(false); await onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
      <div className="d-sec">
        <h3>Go to</h3>
        <div className="acts">
          <Link className="act" href={`/docket?trip=${trip.trip_id}`}>Costs &amp; documents</Link>
          {canBill ? <Link className="act" href={`/billing?trip=${trip.trip_id}`}>Billing</Link> : null}
          {canOverride ? <button className="act" type="button" onClick={() => setEditing(true)}>Edit trip</button> : null}
        </div>
      </div>
      {nexts.length && canWrite ? (
        <div className="d-sec">
          <h3>Next step</h3>
          <div className="acts">
            {nexts.map(([status, label]) => (
              <button
                key={status}
                className={"act" + (status === "delivered" ? " go" : "")}
                disabled={busy}
                onClick={() => advance(status)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {canBorder && canWrite ? (
        <div className="d-sec">
          <h3>Border</h3>
          <div className="acts">
            {trip.status === "in_transit"
              ? borders.map((b) => (
                  <button key={b} className="act" disabled={busy} onClick={() => borderEvent("arrival", b)}>
                    Arrived {b.split("/")[0]}
                  </button>
                ))
              : (() => {
                  const loc = trip.last_border || borders[0] || "";
                  return (
                    <button className="act go" disabled={busy} onClick={() => borderEvent("cleared", loc)}>
                      Cleared {(loc || "border").split("/")[0]}
                    </button>
                  );
                })()}
          </div>
        </div>
      ) : null}
      {trip.status === "delivered" && !trip.pod_in_hand ? (
        <div className="d-sec">
          <h3>Blocked on</h3>
          <div className="d-hint">
            POD not received. {m2(Number(trip.revenue_usd || 0) * 0.5)} can&apos;t be invoiced until it&apos;s in hand.
          </div>
        </div>
      ) : null}
      <div className="d-sec">
        <h3>Assignment</h3>
        <div className="d-kv"><span>Truck</span><span>{trip.fleet_no || "—"}{trip.horse_reg ? " · " + trip.horse_reg : ""}</span></div>
        <div className="d-kv"><span>Driver</span><span>{trip.driver || "—"}</span></div>
        <div className="d-kv"><span>Cargo</span><span>{trip.commodity || "—"}{trip.tonnage ? " · " + trip.tonnage + " t" : ""}</span></div>
        <div className="d-kv"><span>Container</span><span>{trip.container_no || "—"}</span></div>
        <div className="d-kv"><span>Agent</span><span>{trip.agent_name || "—"}</span></div>
      </div>
      <div className="d-sec">
        <h3>Timing</h3>
        <div className="d-kv"><span>Loaded</span><span>{trip.actual_load_date || "—"}</span></div>
        <div className="d-kv"><span>Planned ETA</span><span>{trip.planned_eta || "—"}</span></div>
        <div className="d-kv"><span>Delivered</span><span>{trip.actual_delivery_at ? trip.actual_delivery_at.slice(0, 10) : "—"}</span></div>
        <div className="d-kv"><span>Days running</span><span>{trip.days_running != null ? trip.days_running + " of " + (trip.target_days ?? "?") : "—"}</span></div>
        <div className="d-kv"><span>Last border</span><span>{trip.last_border || "—"}</span></div>
      </div>
        </>
      )}
      {note ? <div className="panel-body" style={{ paddingTop: 0 }}><div className="note bad">{note}</div></div> : null}
    </>
  );
}

function TripEditForm({
  trip,
  data,
  onSaved,
  onCancel,
}: {
  trip: BoardTrip;
  data: BootstrapPayload;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [customerId, setCustomerId] = useState(trip.customer_id);
  const [routeId, setRouteId] = useState(trip.route_id);
  const [borderPathId, setBorderPathId] = useState(
    data.routeBorderPaths.find((p) => p.route_id === trip.route_id && JSON.stringify(p.borders) === JSON.stringify(trip.borders))?.id ?? "",
  );
  const [truckId, setTruckId] = useState(trip.truck_id ?? "");
  const [driverId, setDriverId] = useState(trip.driver_id ?? "");
  const [commodity, setCommodity] = useState(trip.commodity ?? "");
  const [tonnage, setTonnage] = useState(trip.tonnage != null ? String(trip.tonnage) : "");
  const [containerNo, setContainerNo] = useState(trip.container_no ?? "");
  const [sealNo, setSealNo] = useState(trip.seal_no ?? "");
  const [agentName, setAgentName] = useState(trip.agent_name ?? "");
  const [revenue, setRevenue] = useState(String(trip.revenue_usd));
  const [actualLoadDate, setActualLoadDate] = useState(trip.actual_load_date ?? "");
  const [plannedEta, setPlannedEta] = useState(trip.planned_eta ?? "");
  const [actualDeliveryAt, setActualDeliveryAt] = useState(trip.actual_delivery_at ? trip.actual_delivery_at.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    fetch(`/api/trips/${trip.trip_id}`)
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body) => setHistory(body.entries ?? []));
  }, [trip.trip_id]);

  const activeCustomers = data.customers.filter((c) => c.is_active !== false);
  const activeRoutes = data.routes.filter((r) => r.is_active !== false);
  const activeTrucks = data.trucks.filter((t) => t.is_active !== false);
  const activeDrivers = data.drivers.filter((d) => d.is_active !== false);
  const pathsForRoute = data.routeBorderPaths.filter((p) => p.route_id === routeId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const rev = parseFloat(revenue);
    if (isNaN(rev) || rev <= 0) return setError("Enter a valid revenue amount.");

    const chosenPath = data.routeBorderPaths.find((p) => p.id === borderPathId);

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/trips/${trip.trip_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        route_id: routeId,
        truck_id: truckId || null,
        driver_id: driverId || null,
        commodity: commodity.trim() || null,
        tonnage: tonnage ? Number(tonnage) : null,
        container_no: containerNo.trim() || null,
        seal_no: sealNo.trim() || null,
        agent_name: agentName.trim() || null,
        borders: chosenPath ? chosenPath.borders : null,
        revenue_amount: rev,
        actual_load_date: actualLoadDate || null,
        planned_eta: plannedEta || null,
        actual_delivery_at: actualDeliveryAt || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    const body = await res.json();
    if (body.warning) toast.warning(body.warning);
    else toast.success("Trip updated");
    await onSaved();
  }

  return (
    <div className="panel-body">
      <form onSubmit={handleSubmit}>
        {error ? <div className="note bad">{error}</div> : null}
        <div className="field">
          <label htmlFor="eCust">Customer</label>
          <select id="eCust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {activeCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
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
              <option value="">Default ({(activeRoutes.find((r) => r.id === routeId)?.borders || []).join(" → ") || "route's own path"})</option>
              {pathsForRoute.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.borders.join(" → ")})</option>)}
            </select>
          </div>
        ) : null}
        <div className="row">
          <div className="field">
            <label htmlFor="eTruck">Truck</label>
            <select id="eTruck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">—</option>
              {activeTrucks.map((t) => <option key={t.id} value={t.id}>{t.fleet_no}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="eDriver">Driver</label>
            <select id="eDriver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">—</option>
              {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="eComm">Commodity</label>
            <input id="eComm" type="text" value={commodity} onChange={(e) => setCommodity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eTon">Tonnage</label>
            <input id="eTon" type="number" step="0.001" min="0" value={tonnage} onChange={(e) => setTonnage(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="eCont">Container</label>
            <input id="eCont" type="text" value={containerNo} onChange={(e) => setContainerNo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eSeal">Seal</label>
            <input id="eSeal" type="text" value={sealNo} onChange={(e) => setSealNo(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="eAgent">Agent</label>
          <input id="eAgent" type="text" placeholder="Clearing/booking agent" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="eRev">Revenue (USD)</label>
          <input id="eRev" type="number" step="0.01" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="eLoad">Load date</label>
            <input id="eLoad" type="date" value={actualLoadDate} onChange={(e) => setActualLoadDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eEta">Planned ETA</label>
            <input id="eEta" type="date" value={plannedEta} onChange={(e) => setPlannedEta(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="eDelivered">Delivered</label>
          <input id="eDelivered" type="date" value={actualDeliveryAt} onChange={(e) => setActualDeliveryAt(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
      </form>
      <div className="d-sec" style={{ marginTop: 16, paddingLeft: 0, paddingRight: 0, borderBottom: "none" }}>
        <h3>Edit history</h3>
        {history === null ? (
          <div className="d-hint">Loading…</div>
        ) : history.length ? (
          <ul className="list" style={{ maxHeight: 220 }}>
            {history.map((h, i) => (
              <li key={i}>
                <div>
                  <div className="r-no">{lab(h.field)}</div>
                  <div style={{ fontSize: 13 }}>{h.old_value ?? "—"} → {h.new_value ?? "—"}</div>
                  <div className="r-mono">{h.edited_by_email} · {new Date(h.edited_at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="d-hint">No edits yet.</div>
        )}
      </div>
    </div>
  );
}

function NewTripForm({
  data,
  onCancel,
  onCreated,
}: {
  data: BootstrapPayload;
  onCancel: () => void;
  onCreated: (tripId: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [borderPathId, setBorderPathId] = useState("");
  const [revenue, setRevenue] = useState("");
  const [rateHint, setRateHint] = useState<{ text: string; kind: "good" | "warn" } | null>(null);
  const [truckId, setTruckId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [commodity, setCommodity] = useState("");
  const [tonnage, setTonnage] = useState("");
  const [containerNo, setContainerNo] = useState("");
  const [sealNo, setSealNo] = useState("");
  const [agentName, setAgentName] = useState("");
  const [loadDate, setLoadDate] = useState(today());
  const [eta, setEta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyRate(cust: string, route: string) {
    const hit = data.rateCards.find((r) => r.route_id === route && (r.customer_id === cust || !r.customer_id));
    if (hit) {
      setRevenue(Number(hit.rate_amount).toFixed(2));
      setRateHint({
        text: "Filled from the rate card" + (hit.commodity ? " · " + hit.commodity : ""),
        kind: "good",
      });
      if (hit.commodity && !commodity) setCommodity(hit.commodity);
    } else if (cust && route) {
      setRateHint({ text: "No rate card for this pairing. Enter the agreed price.", kind: "warn" });
    } else {
      setRateHint(null);
    }
  }

  function applyEta(route: string, load: string) {
    const r = data.routes.find((x) => x.id === route);
    if (r?.target_days && load) {
      const d = new Date(load);
      d.setDate(d.getDate() + r.target_days);
      setEta(d.toISOString().slice(0, 10));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!customerId || !routeId) return setError("Customer and route are both required.");
    const rev = parseFloat(revenue);
    if (isNaN(rev) || rev <= 0) return setError("Enter the agreed revenue.");

    const chosenPath = data.routeBorderPaths.find((p) => p.id === borderPathId);

    setSaving(true);
    setError(null);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        routeId,
        revenue: rev,
        truckId: truckId || null,
        driverId: driverId || null,
        commodity: commodity.trim() || null,
        tonnage: tonnage ? Number(tonnage) : null,
        containerNo: containerNo.trim() || null,
        sealNo: sealNo.trim() || null,
        agentName: agentName.trim() || null,
        loadDate: loadDate || null,
        eta: eta || null,
        borders: chosenPath ? chosenPath.borders : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError("Couldn't create it: " + (body.error || res.statusText));
    }
    const body = await res.json();
    toast.success(`${body.tripNo} created`);
    onCreated(body.id);
  }

  const activeCustomers = data.customers.filter((c) => c.is_active !== false);
  const activeRoutes = data.routes.filter((r) => r.is_active !== false);
  const activeTrucks = data.trucks.filter((t) => t.is_active !== false);
  const activeDrivers = data.drivers.filter((d) => d.is_active !== false);
  const pathsForRoute = data.routeBorderPaths.filter((p) => p.route_id === routeId);

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="nCust">Customer</label>
        <select
          id="nCust"
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); applyRate(e.target.value, routeId); }}
        >
          <option value="">—</option>
          {activeCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="nRoute">Route</label>
        <select
          id="nRoute"
          value={routeId}
          onChange={(e) => { setRouteId(e.target.value); setBorderPathId(""); applyRate(customerId, e.target.value); applyEta(e.target.value, loadDate); }}
        >
          <option value="">—</option>
          {activeRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {pathsForRoute.length ? (
        <div className="field">
          <label htmlFor="nBorderPath">Border route</label>
          <select id="nBorderPath" value={borderPathId} onChange={(e) => setBorderPathId(e.target.value)}>
            <option value="">Default ({(activeRoutes.find((r) => r.id === routeId)?.borders || []).join(" → ") || "route's own path"})</option>
            {pathsForRoute.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.borders.join(" → ")})</option>)}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="nRev">Revenue (USD)</label>
        <input id="nRev" type="number" step="0.01" min="0" placeholder="0.00" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
      </div>
      {rateHint ? (
        <div className="hint" style={{ color: rateHint.kind === "good" ? "var(--settled)" : "var(--waiting)", margin: "-8px 0 13px" }}>
          {rateHint.text}
        </div>
      ) : null}
      <div className="row">
        <div className="field">
          <label htmlFor="nTruck">Truck</label>
          <select id="nTruck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
            <option value="">—</option>
            {activeTrucks.map((t) => <option key={t.id} value={t.id}>{t.fleet_no}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nDriver">Driver</label>
          <select id="nDriver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">—</option>
            {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nComm">Commodity</label>
          <input id="nComm" type="text" placeholder="General cargo" value={commodity} onChange={(e) => setCommodity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nTon">Tonnage</label>
          <input id="nTon" type="number" step="0.001" min="0" placeholder="28.500" value={tonnage} onChange={(e) => setTonnage(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nCont">Container</label>
          <input id="nCont" type="text" value={containerNo} onChange={(e) => setContainerNo(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nSeal">Seal</label>
          <input id="nSeal" type="text" value={sealNo} onChange={(e) => setSealNo(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nAgent">Agent</label>
        <input id="nAgent" type="text" placeholder="Clearing/booking agent" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nLoad">Load date</label>
          <input id="nLoad" type="date" value={loadDate} onChange={(e) => { setLoadDate(e.target.value); applyEta(routeId, e.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="nEta">Planned ETA</label>
          <input id="nEta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
      </div>
      <button className="primary" type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create trip"}
      </button>
      <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}
