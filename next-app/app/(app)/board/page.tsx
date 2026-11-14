"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, today, waitLabel } from "@/lib/format";
import { useBusyGroup } from "@/lib/useBusyGroup";
import { Spinner } from "@/lib/components/Spinner";
import { buildTimeline, routeProgress, type Stop } from "@/lib/trips/timeline";
import { checkTimes, isTimeField, tripMilestones, type Milestone, type TimeEdits } from "@/lib/trips/milestones";
import type { AuditLogEntry, BoardTrip, BootstrapPayload, TripEvent, TripStatus } from "@/lib/types";
import { useCompanyTimeZone } from "@/lib/components/CompanyTimeZone";

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
  // Trips still on the road past their corridor target -- the ones you can
  // act on. A delivered trip that once ran late is history, not an alert.
  ["late", "Late", (t) => ["loading", "in_transit", "at_border"].includes(t.status) && !!t.over_target],
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

const SORTS: [string, string, (a: BoardTrip, b: BoardTrip) => number][] = [
  ["recent", "Latest loaded", () => 0],
  ["overdue", "Most overdue", (a, b) => lateBy(b) - lateBy(a)],
  ["margin-desc", "Highest margin", (a, b) => Number(b.margin_usd) - Number(a.margin_usd)],
  ["margin-asc", "Lowest margin", (a, b) => Number(a.margin_usd) - Number(b.margin_usd)],
];

function lateBy(t: BoardTrip) {
  return t.days_running != null && t.target_days != null ? t.days_running - t.target_days : -Infinity;
}

// What each trip is still owed under its customer's payment schedule that
// is held back only by a missing POD -- the same projection Billing uses,
// rather than assuming half the revenue.
function podHeldUsd(data: BootstrapPayload, tripId: string) {
  const b = data.billable.find((x) => x.trip_id === tripId);
  return (b?.milestones_due ?? []).filter((m) => m.blocked_reason === "awaiting_pod").reduce((s, m) => s + m.amount_usd, 0);
}

function matchesSearch(t: BoardTrip, q: string) {
  return [t.trip_no, t.customer, t.route, t.fleet_no, t.horse_reg, t.driver, t.container_no, t.commodity]
    .some((v) => v && v.toLowerCase().includes(q));
}

// Mirrors lib/auth/permissions.ts's CAN_MANAGE_TRIPS/CAN_OVERRIDE_RECORDS --
// UI convenience only (hides actions a role can't use), the route handlers
// are the real check.
const CAN_MANAGE_TRIPS = ["owner", "admin", "ops"];
const CAN_OVERRIDE_RECORDS = ["owner", "admin"];

export default function BoardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?filter= and ?trip= let the Overview link straight to a stage or a trip.
  const [filter, setFilter] = useState(() => {
    const wanted = searchParams.get("filter");
    return FILTERS.some((f) => f[0] === wanted) ? wanted! : "active";
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [loadedAt, setLoadedAt] = useState(0);
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("trip"));
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
    setLoadedAt(Date.now());
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

  const all = data.board;
  const rolling = all.filter((t) => ["loading", "in_transit", "at_border"].includes(t.status));
  const late = rolling.filter((t) => t.over_target);
  const pod = all.filter((t) => t.status === "delivered" && !t.pod_in_hand);
  const podHeld = pod.reduce((s, t) => s + podHeldUsd(data, t.trip_id), 0);
  const atBorder = all
    .filter((t) => t.status === "at_border")
    .sort((a, b) => (a.last_border_at ?? "").localeCompare(b.last_border_at ?? ""));
  const longest = atBorder.find((t) => t.last_border_at);
  const longestHours = longest ? (loadedAt - new Date(longest.last_border_at!).getTime()) / 3_600_000 : 0;

  const q = search.trim().toLowerCase();
  const board = q ? all.filter((t) => matchesSearch(t, q)) : all;
  const filterFn = FILTERS.find((f) => f[0] === filter)![2];
  const sortFn = SORTS.find((x) => x[0] === sort)![2];
  const rows = board.filter(filterFn).sort(sortFn);
  const selectedTrip = all.find((t) => t.trip_id === selected) || null;
  const detailOpen = showNewTrip || !!selectedTrip;
  const closeDetail = () => { setSelected(null); setShowNewTrip(false); };
  const canWrite = CAN_MANAGE_TRIPS.includes(data.role);

  return (
    <>
      {error ? <div className="note bad">{error}</div> : null}
      {/* Each figure is also the filter for the trips behind it. */}
      <div className="strip">
        <button type="button" className={"cell" + (filter === "rolling" ? " on" : "")} onClick={() => setFilter("rolling")}>
          <div className="k">On the road</div>
          <div className="v">{rolling.length}</div>
          <div className="n">{all.filter((t) => !["closed", "invoiced"].includes(t.status)).length} active trips</div>
        </button>
        <button type="button" className={"cell" + (filter === "border" ? " on" : "")} onClick={() => setFilter("border")}>
          <div className="k">At border now</div>
          <div className={"v" + (longestHours >= 24 ? " warn" : "")}>{atBorder.length}</div>
          <div className="n">
            {longest
              ? `Longest: ${longest.trip_no} at ${(longest.last_border || "border").split("/")[0].trim()}, ${waitLabel(longest.last_border_at!, loadedAt)}`
              : atBorder.length ? "waiting times not logged" : "none waiting"}
          </div>
        </button>
        <button type="button" className={"cell" + (filter === "late" ? " on" : "")} onClick={() => setFilter("late")}>
          <div className="k">Late</div>
          <div className={"v" + (late.length ? " bad" : "")}>{late.length}</div>
          <div className="n">{late.length ? late.map((t) => t.trip_no).join(", ") : "all on schedule"}</div>
        </button>
        <button type="button" className={"cell" + (filter === "pod" ? " on" : "")} onClick={() => setFilter("pod")}>
          <div className="k">Awaiting POD</div>
          <div className={"v" + (pod.length ? " warn" : "")}>{pod.length}</div>
          <div className="n">{podHeld > 0 ? `${m0(podHeld)} held until POD` : "nothing held back"}</div>
        </button>
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
          <div className="board-tools">
            <input
              type="search"
              aria-label="Search trips"
              placeholder="Search trip, customer, truck, driver, container…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select aria-label="Sort trips" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="chips board-chips">
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
          <ul className="list board-list">
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
                        ) : t.days_running ? (
                          <span className="pill grey">day {t.days_running}{t.target_days ? ` of ${t.target_days}` : ""}</span>
                        ) : null}
                        {t.last_border && ["in_transit", "at_border"].includes(t.status) ? (
                          <span className="pill violet">{t.last_border}</span>
                        ) : null}
                        {t.docs_pending ? (
                          <span className="pill warn">{t.docs_pending} doc{t.docs_pending > 1 ? "s" : ""} pending</span>
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
              <li className="empty">{q ? `No trips match "${search.trim()}".` : "Nothing here."}</li>
            )}
          </ul>
        </div>
        {/* On narrow screens this becomes a full-screen view over the list
            (see .board-detail in globals.css), so tapping a trip shows it
            straight away instead of below every other trip. */}
        <div className={"panel board-detail" + (detailOpen ? " open" : "")}>
          <div className="panel-head">
            <h2>{showNewTrip ? "New trip" : "Trip detail"}</h2>
            <button type="button" className="act board-back" onClick={closeDetail}>← Trips</button>
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
            <TripDetail key={selectedTrip.trip_id} trip={selectedTrip} data={data} onChanged={load} canWrite={canWrite} />
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
  const [editingTimes, setEditingTimes] = useState(false);
  // Bumped after a time correction, which changes the history without
  // moving the trip on.
  const [historyVersion, setHistoryVersion] = useState(0);
  const canOverride = CAN_OVERRIDE_RECORDS.includes(data.role);
  const m = Number(trip.margin_usd || 0);
  const nexts = NEXT[trip.status] || [];
  const canBorder = ["in_transit", "at_border"].includes(trip.status);
  const borders = trip.borders || [];
  const canBill =
    (!trip.pod_in_hand && trip.status === "delivered") ||
    ["pod_received", "in_transit", "at_border", "loading"].includes(trip.status);
  const history = useTripHistory(trip, historyVersion);
  const route = data.routes.find((r) => r.id === trip.route_id);
  const stops = typeof history === "object"
    ? routeProgress(trip, route, history.events, history.fetchedAt)
    : routeProgress(trip, route, [], 0);
  // Once the history is in, only offer the borders still ahead.
  const bordersAhead = typeof history === "object"
    ? stops.filter((s) => s.kind === "border" && s.state !== "done").map((s) => s.location!)
    : borders;

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
      {editing ? null : <RouteLine trip={trip} stops={stops} />}
      {editing ? (
        <TripEditForm
          trip={trip}
          data={data}
          onSaved={async () => { setEditing(false); await onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      ) : editingTimes && typeof history === "object" ? (
        <TimeEditor
          trip={trip}
          history={history}
          onSaved={async () => {
            // Close on the corrected trip, not the old one.
            await onChanged();
            setHistoryVersion((v) => v + 1);
            setEditingTimes(false);
          }}
          onCancel={() => setEditingTimes(false)}
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
      {trip.status === "closed" && canOverride ? (
        <div className="d-sec">
          <h3>Reopen</h3>
          <div className="d-hint">Only if something needs correcting, e.g. a missed expense. Close it again once fixed.</div>
          <div className="acts">
            <button className="act" disabled={busy} onClick={() => advance("invoiced")}>Reopen trip</button>
          </div>
        </div>
      ) : null}
      {canBorder && canWrite ? (
        <div className="d-sec">
          <h3>Border</h3>
          <div className="acts">
            {trip.status === "in_transit"
              ? bordersAhead.length
                ? bordersAhead.map((b) => (
                    <button key={b} className="act" disabled={busy} onClick={() => borderEvent("arrival", b)}>
                      Arrived {b.split("/")[0]}
                    </button>
                  ))
                : <div className="d-hint">All borders cleared. Next stop: {route?.destination || "destination"}.</div>
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
            POD not received.{" "}
            {podHeldUsd(data, trip.trip_id) > 0
              ? <>{m2(podHeldUsd(data, trip.trip_id))} can&apos;t be invoiced until it&apos;s in hand.</>
              : <>No payment milestone is waiting on it.</>}
          </div>
        </div>
      ) : null}
      <div className="d-sec">
        <h3>Assignment</h3>
        <div className="d-kv"><span>Truck</span><span>{trip.fleet_no || "—"}{trip.horse_reg ? " · " + trip.horse_reg : ""}</span></div>
        <div className="d-kv"><span>Driver</span><span>{trip.driver || "—"}</span></div>
        <div className="d-kv"><span>Cargo</span><span>{trip.commodity || "—"}{trip.tonnage ? " · " + trip.tonnage + " t" : ""}{trip.volume_cbm ? " · " + trip.volume_cbm + " m³" : ""}</span></div>
        <div className="d-kv"><span>Container</span><span>{trip.container_no || "—"}</span></div>
        <div className="d-kv"><span>Agent</span><span>{trip.agent_name || "—"}</span></div>
      </div>
      <div className="d-sec">
        <h3>Timing</h3>
        <div className="d-kv"><span>Loaded</span><span>{trip.actual_load_date || "—"}</span></div>
        <div className="d-kv"><span>Planned ETA</span><span>{trip.planned_eta || "—"}</span></div>
        <div className="d-kv"><span>Delivered</span><span>{trip.actual_delivery_at ? new Date(trip.actual_delivery_at).toLocaleDateString("en-CA") : "—"}</span></div>
        <div className="d-kv"><span>Days running</span><span>{trip.days_running != null ? trip.days_running + " of " + (trip.target_days ?? "?") : "—"}</span></div>
        <div className="d-kv"><span>Last border</span><span>{trip.last_border || "—"}</span></div>
      </div>
      <TripHistory history={history} onEditTimes={canWrite ? () => setEditingTimes(true) : null} />
        </>
      )}
      {note ? <div className="panel-body" style={{ paddingTop: 0 }}><div className="note bad">{note}</div></div> : null}
    </>
  );
}

// fetchedAt stands in for "now" when working out how long a truck has
// been waiting at a border.
// refreshing: what's shown is from before the latest change, and a fresh
// copy is on its way.
type History = { createdAt: string | null; events: TripEvent[]; fetchedAt: number; refreshing?: boolean } | "loading" | "error";

// The trip's history, refetched whenever the trip moves on (a status
// change or a border event), and ignored if another trip was opened
// before it arrived.
function useTripHistory(trip: BoardTrip, version: number): History {
  const [state, setState] = useState<{ key: string; history: History } | null>(null);
  const key = [trip.trip_id, trip.status, trip.last_border_at, trip.pod_received_at, version].join("|");
  useEffect(() => {
    let current = true;
    fetch(`/api/trips/${trip.trip_id}/events`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body) => { if (current) setState({ key, history: { ...body, fetchedAt: Date.now() } }); })
      .catch(() => { if (current) setState({ key, history: "error" }); });
    return () => { current = false; };
  }, [key, trip.trip_id]);
  // While a refetch for the same trip is in flight, keep showing what it
  // had rather than flashing "Loading…".
  if (!state || !state.key.startsWith(trip.trip_id + "|")) return "loading";
  return state.key !== key && typeof state.history === "object" ? { ...state.history, refreshing: true } : state.history;
}

// Origin -> each border -> destination, with how far the truck has got
// and how long it waited at each border.
function RouteLine({ trip, stops }: { trip: BoardTrip; stops: Stop[] }) {
  const running = trip.days_running != null && ["loading", "in_transit", "at_border"].includes(trip.status);
  return (
    <div className="d-sec">
      <h3 className="route-head">
        <span>Route</span>
        {running ? (
          <span className={"route-day" + (trip.over_target ? " late" : "")}>
            Day {trip.days_running}{trip.target_days ? ` of ${trip.target_days}` : ""}
          </span>
        ) : null}
      </h3>
      <ol className="route-line" aria-label={`Route: ${stops.map((s) => `${s.label} (${s.state === "done" ? "passed" : s.state === "here" ? "truck is here" : s.state === "next" ? "heading here" : "ahead"})`).join(", ")}`}>
        {stops.map((s, i) => (
          <li key={i} className={"route-stop " + s.state + " " + s.kind}>
            <span className="route-dot" aria-hidden="true" />
            <span className="route-name">{s.label}</span>
            {s.note ? <span className="route-note">{s.note}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TripHistory({ history, onEditTimes }: { history: History; onEditTimes: (() => void) | null }) {
  return (
    <div className="d-sec">
      <h3 className="tl-head">
        <span>History</span>
        {typeof history === "object" && history.refreshing ? (
          <span className="tl-updating" role="status">Updating…</span>
        ) : onEditTimes && typeof history === "object" ? (
          <button type="button" className="act sm" onClick={onEditTimes}>Edit times</button>
        ) : null}
      </h3>
      {history === "loading" ? (
        <div className="d-hint">Loading…</div>
      ) : history === "error" ? (
        <div className="d-hint">Couldn&apos;t load the history.</div>
      ) : (
        <ol className={"tl" + (history.refreshing ? " stale" : "")}>
          {buildTimeline(history.createdAt, history.events).map((e, i) => (
            <li key={i} className={"tl-item " + e.tone}>
              <div className="tl-top">
                <span className="tl-title">
                  {e.title}
                  {e.flag ? <span className="tl-flag" title={e.flag.title}>{e.flag.text}</span> : null}
                </span>
                <time className="tl-when" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{whenLabel(e.at)}</time>
              </div>
              {e.detail || e.by || e.sinceLast ? (
                <div className="tl-sub">
                  {[e.detail, e.sinceLast ? `${e.sinceLast} later` : null, e.by].filter(Boolean).join(" · ")}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// An edit-history value as people read it: dates and times spelled out,
// anything else as stored.
function auditValue(v: string | null) {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(v + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v))) {
    return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return v;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
// Date-and-time inputs work in the browser's own time zone.
function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const inputValue = (m: Milestone) => (m.value ? (m.type === "date" ? m.value : toLocalInput(m.value)) : "");
// Run on save, against the clock at that moment.
const checkTimesNow = (ms: Milestone[], edits: TimeEdits, timeZone: string, dayZone: string) => checkTimes(ms, edits, Date.now(), timeZone, dayZone);
// Rows sit under their stop: the loading point, each border crossing, delivery.
const groupKey = (m: Milestone) => (m.key.includes(":") ? m.key.split(":").slice(0, 2).join(":") : m.group);

// Correcting when each milestone happened: the load date, loading started,
// departed, every border arrival and clearance (adding any nobody logged),
// delivered and POD received. Checked here as you save, and again on the
// server against the trip as it is by then.
function TimeEditor({
  trip,
  history,
  onSaved,
  onCancel,
}: {
  trip: BoardTrip;
  history: Exclude<History, "loading" | "error">;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  // Fixed when the editor opens: what the form shows is what the server
  // is told it's changing from.
  const [ms] = useState(() => tripMilestones(trip, history.events));
  const [inputs, setInputs] = useState<Record<string, string>>(() => Object.fromEntries(ms.map((m) => [m.key, inputValue(m)])));
  const [adding, setAdding] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [corrections, setCorrections] = useState<AuditLogEntry[] | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const companyTimeZone = useCompanyTimeZone();

  useEffect(() => {
    fetch(`/api/trips/${trip.trip_id}`)
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body) => setCorrections((body.entries ?? []).filter((h: AuditLogEntry) => isTimeField(h.field))))
      .catch(() => setCorrections([]));
  }, [trip.trip_id]);

  const changed = (m: Milestone) => m.editable && !!inputs[m.key] && inputs[m.key] !== inputValue(m);

  // What the form now says differs from the record.
  function collect(values: Record<string, string>) {
    const edits: TimeEdits = {};
    const changes: { key: string; from: string | null; to: string }[] = [];
    for (const m of ms) {
      const v = values[m.key];
      if (!m.editable || !v || v === inputValue(m)) continue;
      const to = m.type === "date" ? v : new Date(v).toISOString();
      edits[m.key] = to;
      changes.push({ key: m.key, from: m.value, to });
    }
    return { edits, changes };
  }

  function update(values: Record<string, string>) {
    const next = { ...inputs, ...values };
    setInputs(next);
    // Once problems are on show, keep them current as times are fixed.
    if (Object.keys(errors).length) {
      const found = checkTimesNow(ms, collect(next).edits, timeZone, companyTimeZone);
      setErrors(found);
      setFormError(Object.keys(found).length ? "Some times need fixing." : null);
    } else {
      setFormError(null);
    }
  }

  function stopAdding(group: string, rows: Milestone[]) {
    setAdding((prev) => prev.filter((g) => g !== group));
    update(Object.fromEntries(rows.map((m) => [m.key, ""])));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { edits, changes } = collect(inputs);
    if (!changes.length) {
      setFormError("Nothing has changed yet.");
      return;
    }
    const found = checkTimesNow(ms, edits, timeZone, companyTimeZone);
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError("Some times need fixing.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const res = await fetch(`/api/trips/${trip.trip_id}/times`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone, changes }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setErrors(body.errors ?? {});
      setFormError(body.error || res.statusText);
      return;
    }
    toast.success(changes.length === 1 ? "Time corrected" : `${changes.length} times corrected`);
    // Still "Saving…" while the Board reloads.
    await onSaved();
  }

  const groups: { key: string; name: string; rows: Milestone[] }[] = [];
  for (const m of ms) {
    const g = groups.find((x) => x.key === groupKey(m));
    if (g) g.rows.push(m);
    else groups.push({ key: groupKey(m), name: m.group, rows: [m] });
  }

  return (
    <div className="panel-body times">
      <form onSubmit={handleSubmit}>
        <h3 className="times-title">Correct times</h3>
        <p className="d-hint times-intro">
          In {timeZone.split("/").pop()!.replace(/_/g, " ")} time. Days running, border waits and the Overview follow
          these. Every change is kept in the edit history.
        </p>
        {formError ? <div className="note bad">{formError}</div> : null}
        {groups.map((g) => {
          const notLogged = g.rows.every((m) => m.value == null && m.editable && m.add);
          const open = !notLogged || adding.includes(g.key);
          return (
            <fieldset key={g.key} className="times-group">
              <legend>{g.name}</legend>
              {!open ? (
                <div className="times-missing">
                  <span>Not logged</span>
                  <button type="button" className="act sm" onClick={() => setAdding((prev) => [...prev, g.key])}>
                    Add crossing
                  </button>
                </div>
              ) : (
                <>
                  {g.rows.map((m) => {
                    const id = "t-" + m.key.replace(/:/g, "-");
                    const err = errors[m.key];
                    const sub = err
                      ? <span className="times-err" id={id + "-msg"}>{err}</span>
                      : changed(m) && m.value
                        ? <span id={id + "-msg"}>Was {auditValue(m.value)}</span>
                        : m.value == null && m.editable && !notLogged
                          ? <span id={id + "-msg"}>Not logged</span>
                          : m.note
                            ? <span id={id + "-msg"}>{m.note}</span>
                            : null;
                    return (
                      <div key={m.key} className={"times-row" + (changed(m) ? " changed" : "")}>
                        <label htmlFor={id}>{m.label}</label>
                        {m.editable ? (
                          <input
                            id={id}
                            type={m.type === "date" ? "date" : "datetime-local"}
                            value={inputs[m.key]}
                            required={m.value != null}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={sub ? id + "-msg" : undefined}
                            onChange={(e) => update({ [m.key]: e.target.value })}
                          />
                        ) : (
                          <span id={id} className="times-fixed">{m.value ? whenLabel(m.value) : "—"}</span>
                        )}
                        {sub ? <div className="times-sub">{sub}</div> : null}
                      </div>
                    );
                  })}
                  {notLogged ? (
                    <button type="button" className="times-undo" onClick={() => stopAdding(g.key, g.rows)}>
                      Don&apos;t add
                    </button>
                  ) : null}
                </>
              )}
            </fieldset>
          );
        })}
        <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save times"}</button>
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
      </form>
      <div className="times-log">
        <h3>Corrections</h3>
        {corrections === null ? (
          <div className="d-hint">Loading…</div>
        ) : corrections.length ? (
          <ul>
            {corrections.map((h, i) => (
              <li key={i}>
                <div className="times-log-what">
                  <span>{h.field === "actual_load_date" ? "Load date" : h.field === "actual_delivery_at" ? "Delivered" : h.field}</span>
                  <span>{auditValue(h.old_value)} → {auditValue(h.new_value)}</span>
                </div>
                <div className="times-log-who">{h.edited_by_email} · {auditValue(h.edited_at)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="d-hint">No times corrected yet.</div>
        )}
      </div>
    </div>
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
  const [volumeCbm, setVolumeCbm] = useState(trip.volume_cbm != null ? String(trip.volume_cbm) : "");
  const [containerNo, setContainerNo] = useState(trip.container_no ?? "");
  const [sealNo, setSealNo] = useState(trip.seal_no ?? "");
  const [agentName, setAgentName] = useState(trip.agent_name ?? "");
  const [revenue, setRevenue] = useState(String(trip.revenue_usd));
  const [plannedEta, setPlannedEta] = useState(trip.planned_eta ?? "");
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
        volume_cbm: volumeCbm ? Number(volumeCbm) : null,
        container_no: containerNo.trim() || null,
        seal_no: sealNo.trim() || null,
        agent_name: agentName.trim() || null,
        borders: chosenPath ? chosenPath.borders : null,
        revenue_amount: rev,
        planned_eta: plannedEta || null,
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
        <div className="field">
          <label htmlFor="eComm">Commodity</label>
          <input id="eComm" type="text" value={commodity} onChange={(e) => setCommodity(e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="eTon">Tonnage</label>
            <input id="eTon" type="number" step="0.001" min="0" value={tonnage} onChange={(e) => setTonnage(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eVol">Volume (m³)</label>
            <input id="eVol" type="number" step="0.001" min="0" value={volumeCbm} onChange={(e) => setVolumeCbm(e.target.value)} />
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
        <div className="field">
          <label htmlFor="eEta">Planned ETA</label>
          <input id="eEta" type="date" value={plannedEta} onChange={(e) => setPlannedEta(e.target.value)} />
          <div className="hint">The load date, delivery and other times are corrected with Edit times, in the trip&apos;s history.</div>
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
                  <div style={{ fontSize: 13 }}>{auditValue(h.old_value)} → {auditValue(h.new_value)}</div>
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
  const [volumeCbm, setVolumeCbm] = useState("");
  const [containerNo, setContainerNo] = useState("");
  const [sealNo, setSealNo] = useState("");
  const [agentName, setAgentName] = useState("");
  const [loadDate, setLoadDate] = useState(today(useCompanyTimeZone()));
  const [eta, setEta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-run on customer/route change (as before) and now also on
  // tonnage/volume change, since a per_tonne/per_cbm rate card needs
  // whichever quantity its basis calls for -- entered later in the form
  // than customer/route, so this can't just be a one-shot lookup.
  function applyRate(cust: string, route: string, ton: string, vol: string) {
    const hit = data.rateCards.find((r) => r.route_id === route && (r.customer_id === cust || !r.customer_id));
    if (hit) {
      const basis = hit.rate_basis;
      const qty = basis === "per_tonne" ? parseFloat(ton) : basis === "per_cbm" ? parseFloat(vol) : 1;
      if (basis !== "per_trip" && !(Number.isFinite(qty) && qty > 0)) {
        setRateHint({
          text: `${m2(hit.rate_amount)} ${basis === "per_tonne" ? "per tonne" : "per m³"}${hit.commodity ? " · " + hit.commodity : ""} — enter ${basis === "per_tonne" ? "tonnage" : "volume"} to calculate.`,
          kind: "warn",
        });
        // Leave revenue as whatever the user already has -- don't stomp
        // it with a wrong figure just because the quantity isn't in yet.
      } else {
        const amount = basis === "per_trip" ? Number(hit.rate_amount) : Number(hit.rate_amount) * qty;
        setRevenue(amount.toFixed(2));
        setRateHint({
          text: "Filled from the rate card"
            + (hit.commodity ? " · " + hit.commodity : "")
            + (basis !== "per_trip" ? ` (${m2(hit.rate_amount)} × ${qty} ${basis === "per_tonne" ? "t" : "m³"})` : ""),
          kind: "good",
        });
      }
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
        volumeCbm: volumeCbm ? Number(volumeCbm) : null,
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
          onChange={(e) => { setCustomerId(e.target.value); applyRate(e.target.value, routeId, tonnage, volumeCbm); }}
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
          onChange={(e) => { setRouteId(e.target.value); setBorderPathId(""); applyRate(customerId, e.target.value, tonnage, volumeCbm); applyEta(e.target.value, loadDate); }}
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
      <div className="field">
        <label htmlFor="nComm">Commodity</label>
        <input id="nComm" type="text" placeholder="General cargo" value={commodity} onChange={(e) => setCommodity(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nTon">Tonnage</label>
          <input
            id="nTon"
            type="number"
            step="0.001"
            min="0"
            placeholder="28.500"
            value={tonnage}
            onChange={(e) => { setTonnage(e.target.value); applyRate(customerId, routeId, e.target.value, volumeCbm); }}
          />
        </div>
        <div className="field">
          <label htmlFor="nVol">Volume (m³)</label>
          <input
            id="nVol"
            type="number"
            step="0.001"
            min="0"
            placeholder="e.g. for tankers/tippers"
            value={volumeCbm}
            onChange={(e) => { setVolumeCbm(e.target.value); applyRate(customerId, routeId, tonnage, e.target.value); }}
          />
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
