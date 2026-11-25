"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, today, waitLabel } from "@/lib/format";
import { useBusyGroup } from "@/lib/useBusyGroup";
import { Spinner } from "@/lib/components/Spinner";
import { buildTimeline, routeProgress, type Stop } from "@/lib/trips/timeline";
import { checkTimes, isTimeField, tripMilestones, type Milestone, type TimeEdits } from "@/lib/trips/milestones";
import type { AuditLogEntry, BoardTrip, BootstrapPayload, RateCard, TripEvent, TripStatus } from "@/lib/types";
import { pickRateCard, type RatePick } from "@/lib/rates/pickRateCard";
import { useCompanyTimeZone } from "@/lib/components/CompanyTimeZone";
import { PageBand } from "@/lib/components/PageBand";
import { RouteTrack, TruckIcon } from "@/lib/components/RouteTrack";
import { MoneyStrip } from "@/lib/components/MoneyStrip";
import { STATUS_PILL } from "@/lib/trips/status";

const PILL = STATUS_PILL;

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
  // draft -> allocated goes through AllocateTrip, which asks for the truck and driver.
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
  return [t.trip_no, t.customer, t.route, t.fleet_no, t.horse_reg, t.trailer_reg, t.driver, t.container_no, t.commodity]
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
  const routeById = new Map(data.routes.map((r) => [r.id, r]));

  const activeCount = all.filter((t) => !["closed", "invoiced"].includes(t.status)).length;

  return (
    <>
      {error ? <div className="note bad">{error}</div> : null}
      {/* Each figure is also the filter for the trips behind it. */}
      <PageBand
        kicker="Board"
        title={`${activeCount} active trip${activeCount === 1 ? "" : "s"}`}
        sub={`${rolling.length} on the road${atBorder.length ? `, ${atBorder.length} at a border` : ""}${late.length ? `, ${late.length} late` : ""}`}
        actions={canWrite ? (
          <button type="button" className="ops-cta" onClick={() => { setShowNewTrip(true); setSelected(null); }}>
            + New trip
          </button>
        ) : null}
        figs={[
          { key: "rolling", k: "On the road", v: rolling.length, n: "loading, in transit or at a border", on: filter === "rolling", onClick: () => setFilter("rolling") },
          {
            key: "border",
            k: "At border now",
            v: atBorder.length,
            tone: longestHours >= 24 ? "warn" : undefined,
            n: longest
              ? `Longest: ${longest.trip_no} at ${(longest.last_border || "border").split("/")[0].trim()}, ${waitLabel(longest.last_border_at!, loadedAt)}`
              : atBorder.length ? "waiting times not logged" : "none waiting",
            on: filter === "border",
            onClick: () => setFilter("border"),
          },
          { key: "late", k: "Late", v: late.length, tone: late.length ? "bad" : undefined, n: late.length ? late.map((t) => t.trip_no).join(", ") : "all on schedule", on: filter === "late", onClick: () => setFilter("late") },
          { key: "pod", k: "Awaiting POD", v: pod.length, tone: pod.length ? "warn" : undefined, n: podHeld > 0 ? `${m0(podHeld)} held until POD` : "nothing held back", on: filter === "pod", onClick: () => setFilter("pod") },
        ]}
      />
      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Trips</h2>
            <span className="r-min">{rows.length} shown</span>
          </div>
          <div className="board-tools">
            <input
              type="search"
              aria-label="Search trips"
              placeholder="Search trip, customer, truck, trailer, driver, container…"
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
                    <div style={{ minWidth: 0 }}>
                      <div className="row-top">
                        <span className="r-no">{t.trip_no}</span>
                        <span className={"pill " + (PILL[t.status] || "grey")}>{lab(t.status)}</span>
                        {t.over_target ? (
                          <span className="pill bad">day {t.days_running} of {t.target_days}</span>
                        ) : t.days_running ? (
                          <span className="pill grey">day {t.days_running}{t.target_days ? ` of ${t.target_days}` : ""}</span>
                        ) : null}
                        {t.last_border && ["in_transit", "at_border"].includes(t.status) ? (
                          <span className="pill violet">{t.status === "at_border" ? "at " : "cleared "}{t.last_border.split("/")[0].trim()}</span>
                        ) : null}
                        {t.docs_pending ? (
                          <span className="pill warn">{t.docs_pending} doc{t.docs_pending > 1 ? "s" : ""} pending</span>
                        ) : null}
                        {t.status === "delivered" && !t.pod_in_hand ? (
                          <span className="pill warn">no POD</span>
                        ) : null}
                      </div>
                      <div className="r-title">{t.customer}</div>
                      <div className="r-sub">
                        {t.route}
                        {t.fleet_no ? " · " + t.fleet_no : ""}
                        {t.driver ? " · " + t.driver : ""}
                      </div>
                      <RouteTrack trip={t} route={routeById.get(t.route_id)} />
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
              onAdded={load}
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
  // The trailer going when the trip starts loading: the truck's current
  // one until someone types over it.
  const truckTrailer = data.trucks.find((t) => t.id === trip.truck_id)?.trailer_reg ?? "";
  const [trailerTyped, setTrailerTyped] = useState<string | null>(null);
  const trailer = trailerTyped ?? truckTrailer;
  const canOverride = CAN_OVERRIDE_RECORDS.includes(data.role);
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

  async function advance(status: TripStatus, extra?: { truckId: string; driverId: string } | { trailerReg: string }) {
    setNote(null);
    await run(async () => {
      const res = await fetch(`/api/trips/${trip.trip_id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
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
      <div className="d-head trip-card">
        <div className="tc-top">
          <span className="r-no">{trip.trip_no}</span>
          <span className={"pill " + (PILL[trip.status] || "grey")}>{lab(trip.status)}</span>
          {trip.days_running ? (
            <span className={"pill " + (trip.over_target ? "bad" : "grey")}>day {trip.days_running}{trip.target_days ? ` of ${trip.target_days}` : ""}</span>
          ) : null}
        </div>
        <div className="tc-title">{trip.customer}</div>
        <div className="r-sub">
          {trip.route}
          {trip.fleet_no ? " · " + trip.fleet_no : ""}
          {trip.driver ? " · " + trip.driver : ""}
        </div>
        <MoneyStrip trip={trip} />
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
      {trip.status === "draft" && canWrite ? (
        <AllocateTrip
          key={trip.trip_id}
          trip={trip}
          data={data}
          busy={busy}
          onAllocate={(truckId, driverId) => advance("allocated", { truckId, driverId })}
        />
      ) : nexts.length && canWrite ? (
        <div className="d-sec">
          <h3>Next step</h3>
          {trip.status === "allocated" ? (
            <div className="field">
              <label htmlFor="ldTrailer">Trailer going</label>
              <input id="ldTrailer" type="text" maxLength={40} placeholder="Trailer plate" value={trailer} onChange={(e) => setTrailerTyped(e.target.value)} />
              <div className="hint">
                {truckTrailer
                  ? `${trip.fleet_no}'s current trailer. If a different one is going, enter it: it's saved on this trip and becomes ${trip.fleet_no}'s current trailer.`
                  : `No trailer on file for ${trip.fleet_no ?? "this truck"}. Enter the one that's going, or leave it empty if there's none.`}
              </div>
            </div>
          ) : null}
          <div className="acts">
            {nexts.map(([status, label]) => (
              <button
                key={status}
                className={"act" + (status === "delivered" ? " go" : "")}
                disabled={busy}
                onClick={() => advance(status, status === "loading" ? { trailerReg: trailer } : undefined)}
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
        <div className="d-kv">
          <span>Trailer</span>
          <span>{trip.trailer_reg || (trip.actual_load_date ? "Not recorded" : "Recorded when loading starts")}</span>
        </div>
        <div className="d-kv"><span>Driver</span><span>{trip.driver || "—"}</span></div>
        <div className="d-kv"><span>Cargo</span><span>{trip.commodity || "—"}{trip.tonnage ? " · " + trip.tonnage + " t" : ""}{trip.volume_cbm ? " · " + trip.volume_cbm + " m³" : ""}</span></div>
        <div className="d-kv"><span>Container</span><span>{trip.container_no || "—"}</span></div>
        <div className="d-kv"><span>Agent</span><span>{trip.agent_name || "—"}</span></div>
      </div>
      <div className="d-sec">
        <h3>Timing</h3>
        <div className="d-kv"><span>Planned load</span><span>{trip.planned_load_date || "—"}</span></div>
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
  // The truck: above the stop it's standing at, or on the road to the next
  // one while it's moving.
  const here = stops.findIndex((s) => s.state === "here");
  const next = here < 0 && running ? stops.findIndex((s) => s.state === "next") : -1;
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
            {i === here || i === next ? (
              <span className={"route-truck" + (i === next ? " between" : "")}><TruckIcon /></span>
            ) : null}
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
  // Only once the trip has loaded: before that it's set by Start loading.
  const loaded = !!trip.actual_load_date;
  const [trailerReg, setTrailerReg] = useState(trip.trailer_reg ?? "");
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
        // Only when it's been changed, so an untouched plate never shows up as an edit.
        ...(loaded && trailerReg.trim() !== (trip.trailer_reg ?? "").trim() ? { trailer_reg: trailerReg.trim() || null } : {}),
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
            <select
              id="eTruck"
              value={truckId}
              onChange={(e) => {
                setTruckId(e.target.value);
                // A loaded trip moved to another truck takes that truck's trailer.
                if (loaded) setTrailerReg(data.trucks.find((t) => t.id === e.target.value)?.trailer_reg ?? "");
              }}
            >
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
        {loaded ? (
          <div className="field">
            <label htmlFor="eTrailer">Trailer</label>
            <input id="eTrailer" type="text" maxLength={40} placeholder="Trailer plate" value={trailerReg} onChange={(e) => setTrailerReg(e.target.value)} />
            <div className="hint">The trailer that went on this trip. Choosing another truck fills in that truck&apos;s current trailer.</div>
          </div>
        ) : null}
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
  onAdded,
}: {
  data: BootstrapPayload;
  onCancel: () => void;
  onCreated: (tripId: string) => void;
  // "Create and add another": the trip is saved and the form stays open
  // for the next truck on the same job.
  onAdded: () => Promise<void>;
}) {
  const companyToday = today(useCompanyTimeZone());
  const [customerId, setCustomerId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [borderPathId, setBorderPathId] = useState("");
  const [commodity, setCommodity] = useState("");
  const [tonnage, setTonnage] = useState("");
  const [volumeCbm, setVolumeCbm] = useState("");
  const [revenue, setRevenue] = useState("");
  // Where the revenue figure came from. A rate card's price is kept in
  // step with the form and cleared once no card applies; a price someone
  // typed is never replaced.
  const [revenueFrom, setRevenueFrom] = useState<"rate" | "typed" | null>(null);
  const [truckId, setTruckId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [loadDate, setLoadDate] = useState(companyToday);
  const [eta, setEta] = useState("");
  // An ETA someone typed isn't replaced when the route or load date changes.
  const [etaTyped, setEtaTyped] = useState(false);
  const [containerNo, setContainerNo] = useState("");
  const [sealNo, setSealNo] = useState("");
  const [agentName, setAgentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Field messages appear once someone tries to save, then follow the form.
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  // Trips made with "Create and add another", for the note at the top.
  const [added, setAdded] = useState<string[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);

  // A save that fails shows its message at the top of a long form.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  const inputs: RateInputs = { customerId, routeId, tonnage, volumeCbm, commodity, loadDate };
  const rate = rateFor(data.rateCards, inputs, companyToday);
  const fields = { customerId, routeId, tonnage, volumeCbm, revenue, loadDate, eta };
  const fieldErrors = tried ? checkNewTrip(fields) : {};

  // Called with whichever field just changed. Keeps a rate-card price in
  // step, and clears it once no card prices this trip any more, so a
  // figure from a previous customer or route can't be saved by mistake.
  function reprice(changed: Partial<RateInputs>) {
    const next = { ...inputs, ...changed };
    const r = rateFor(data.rateCards, next, companyToday);
    if (r?.card?.commodity && !next.commodity.trim()) setCommodity(r.card.commodity.trim());
    if (revenueFrom === "typed") return;
    if (r?.price != null) {
      setRevenue(r.price.toFixed(2));
      setRevenueFrom("rate");
    } else if (revenueFrom === "rate") {
      setRevenue("");
      setRevenueFrom(null);
    }
  }

  function takeRatePrice() {
    if (rate?.price == null) return;
    setRevenue(rate.price.toFixed(2));
    setRevenueFrom("rate");
  }

  function chooseCommodity(c: string) {
    setCommodity(c);
    reprice({ commodity: c });
  }

  function applyEta(route: string, load: string) {
    if (etaTyped) return;
    const r = data.routes.find((x) => x.id === route);
    if (r?.target_days && load) setEta(addDays(load, r.target_days));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const another = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another";
    setTried(true);
    const errors = checkNewTrip(fields);
    const first = (Object.keys(NEW_TRIP_FIELD_IDS) as (keyof NewTripErrors)[]).find((k) => errors[k]);
    if (first) {
      const el = document.getElementById(NEW_TRIP_FIELD_IDS[first]);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    const chosenPath = data.routeBorderPaths.find((p) => p.id === borderPathId);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        routeId,
        revenue: Number(revenue),
        truckId: truckId || null,
        driverId: driverId || null,
        commodity: commodity.trim() || null,
        tonnage: tonnage.trim() ? Number(tonnage) : null,
        volumeCbm: volumeCbm.trim() ? Number(volumeCbm) : null,
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
    if (!another) return onCreated(body.id);

    // Same job, next truck: keep the customer, route, cargo, price and
    // dates; clear what's particular to one truck.
    const fleet = data.trucks.find((t) => t.id === truckId)?.fleet_no;
    setAdded((a) => [...a, fleet ? `${body.tripNo} (${fleet})` : body.tripNo]);
    setTruckId("");
    setDriverId("");
    setContainerNo("");
    setSealNo("");
    setTried(false);
    document.getElementById("nTruck")?.focus();
    // Refreshes the Board, so the truck just used shows as on its trip.
    await onAdded();
  }

  const activeCustomers = data.customers.filter((c) => c.is_active !== false);
  const activeRoutes = data.routes.filter((r) => r.is_active !== false);
  const pathsForRoute = data.routeBorderPaths.filter((p) => p.route_id === routeId);
  const invalid = (k: keyof NewTripErrors) => (fieldErrors[k] ? { "aria-invalid": true, "aria-describedby": `${NEW_TRIP_FIELD_IDS[k]}-err` } : {});
  const fieldError = (k: keyof NewTripErrors) =>
    fieldErrors[k] ? <div className="field-err" id={`${NEW_TRIP_FIELD_IDS[k]}-err`}>{fieldErrors[k]}</div> : null;
  const required = <span className="req" aria-hidden="true"> *</span>;

  return (
    <form className="panel-body" onSubmit={handleSubmit} noValidate>
      {error ? <div className="note bad" ref={errorRef}>{error}</div> : null}
      {added.length ? (
        <div className="note good">Created {added.join(", ")}. Pick the next truck, or press Done.</div>
      ) : null}

      <h3 className="form-part">Customer &amp; cargo</h3>
      <div className="field">
        <label htmlFor="nCust">Customer{required}</label>
        <select
          id="nCust"
          aria-required="true"
          {...invalid("customer")}
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); reprice({ customerId: e.target.value }); }}
        >
          <option value="">—</option>
          {activeCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {fieldError("customer")}
      </div>
      <div className="field">
        <label htmlFor="nRoute">Route{required}</label>
        <select
          id="nRoute"
          aria-required="true"
          {...invalid("route")}
          value={routeId}
          onChange={(e) => { setRouteId(e.target.value); setBorderPathId(""); reprice({ routeId: e.target.value }); applyEta(e.target.value, loadDate); }}
        >
          <option value="">—</option>
          {activeRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {fieldError("route")}
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
        <label htmlFor="nComm">Commodity</label>
        <input id="nComm" type="text" placeholder="e.g. copper cathodes" value={commodity} onChange={(e) => { setCommodity(e.target.value); reprice({ commodity: e.target.value }); }} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nTon">Tonnage (t)</label>
          <input
            id="nTon"
            type="number"
            step="0.001"
            min="0"
            {...invalid("tonnage")}
            value={tonnage}
            onChange={(e) => { setTonnage(e.target.value); reprice({ tonnage: e.target.value }); }}
          />
          {fieldError("tonnage")}
        </div>
        <div className="field">
          <label htmlFor="nVol">Volume (m³)</label>
          <input
            id="nVol"
            type="number"
            step="0.001"
            min="0"
            {...invalid("volume")}
            value={volumeCbm}
            onChange={(e) => { setVolumeCbm(e.target.value); reprice({ volumeCbm: e.target.value }); }}
          />
          {fieldError("volume")}
        </div>
      </div>
      <div className="field">
        <label htmlFor="nRev">Revenue (USD){required}</label>
        <input
          id="nRev"
          type="number"
          step="0.01"
          min="0"
          aria-required="true"
          {...invalid("revenue")}
          value={revenue}
          onChange={(e) => { setRevenue(e.target.value); setRevenueFrom(e.target.value.trim() ? "typed" : null); }}
        />
        {fieldError("revenue")}
      </div>
      <RateHint rate={rate} revenue={revenue} revenueFrom={revenueFrom} commodity={commodity} onDate={loadDate || companyToday} onUsePrice={takeRatePrice} onChooseCommodity={chooseCommodity} />

      <h3 className="form-part">Truck &amp; schedule</h3>
      <TruckDriverFields
        idPrefix="n"
        data={data}
        truckId={truckId}
        driverId={driverId}
        onChange={(next) => { setTruckId(next.truckId); setDriverId(next.driverId); }}
      />
      <div className="row">
        <div className="field">
          <label htmlFor="nLoad">Planned load date</label>
          <input id="nLoad" type="date" value={loadDate} onChange={(e) => { setLoadDate(e.target.value); reprice({ loadDate: e.target.value }); applyEta(routeId, e.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="nEta">Planned ETA</label>
          <input id="nEta" type="date" {...invalid("eta")} value={eta} onChange={(e) => { setEta(e.target.value); setEtaTyped(!!e.target.value); }} />
          {fieldError("eta")}
        </div>
      </div>

      <h3 className="form-part">Cargo papers</h3>
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
        <input id="nAgent" type="text" placeholder="Clearing or booking agent" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
      </div>

      <button className="primary" type="submit" name="create" disabled={saving}>
        {saving ? "Creating…" : "Create trip"}
      </button>
      <button className="ghost" type="submit" name="another" disabled={saving}>Create and add another</button>
      <button className="ghost" type="button" onClick={onCancel}>{added.length ? "Done" : "Cancel"}</button>
    </form>
  );
}

type NewTripErrors = Partial<Record<"customer" | "route" | "tonnage" | "volume" | "revenue" | "eta", string>>;
// In the order they appear, so the first one wrong is the one focused.
const NEW_TRIP_FIELD_IDS = { customer: "nCust", route: "nRoute", tonnage: "nTon", volume: "nVol", revenue: "nRev", eta: "nEta" } as const;

function checkNewTrip(f: { customerId: string; routeId: string; tonnage: string; volumeCbm: string; revenue: string; loadDate: string; eta: string }): NewTripErrors {
  const e: NewTripErrors = {};
  const quantity = (v: string) => !v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0);
  if (!f.customerId) e.customer = "Choose the customer.";
  if (!f.routeId) e.route = "Choose the route.";
  if (!quantity(f.tonnage)) e.tonnage = "Enter tonnes, 0 or more.";
  if (!quantity(f.volumeCbm)) e.volume = "Enter m³, 0 or more.";
  const rev = Number(f.revenue);
  if (!f.revenue.trim() || !Number.isFinite(rev) || rev <= 0) e.revenue = "Enter the agreed price.";
  if (f.eta && f.loadDate && f.eta < f.loadDate) e.eta = "Can't be before the planned load date.";
  return e;
}

const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// A trip holds its truck and driver from allocation until delivery.
const COMMITTED = new Set<TripStatus>(["allocated", "loading", "in_transit", "at_border"]);

// Which trips each truck and driver is already on.
function commitments(board: BoardTrip[], exceptTripId?: string) {
  const trucks = new Map<string, BoardTrip[]>();
  const drivers = new Map<string, BoardTrip[]>();
  for (const t of board) {
    if (t.trip_id === exceptTripId || !COMMITTED.has(t.status)) continue;
    if (t.truck_id) trucks.set(t.truck_id, [...(trucks.get(t.truck_id) ?? []), t]);
    if (t.driver_id) drivers.set(t.driver_id, [...(drivers.get(t.driver_id) ?? []), t]);
  }
  return { trucks, drivers };
}

const onTrips = (trips: BoardTrip[]) => trips.map((t) => `${t.trip_no} (${lab(t.status)})`).join(", ");

// The driver on a truck's latest trip, if they're still active.
function usualDriver(data: BootstrapPayload, truckId: string) {
  const last = data.board
    .filter((t) => t.truck_id === truckId && t.driver_id)
    .sort((a, b) => b.trip_no.localeCompare(a.trip_no))[0];
  return last && data.drivers.some((d) => d.id === last.driver_id && d.is_active !== false) ? last.driver_id : null;
}

// Truck and driver pickers for the New trip form and for allocating a
// draft: each option says if it's already on a trip (still allowed -- a
// truck can be booked for its next job while it's on the road), and a
// truck brings its usual driver along unless one was picked by hand.
function TruckDriverFields({
  idPrefix,
  data,
  truckId,
  driverId,
  onChange,
  exceptTripId,
}: {
  idPrefix: string;
  data: BootstrapPayload;
  truckId: string;
  driverId: string;
  onChange: (next: { truckId: string; driverId: string }) => void;
  exceptTripId?: string;
}) {
  // The driver was filled in as the truck's usual one, so choosing another
  // truck swaps them too.
  const [driverAuto, setDriverAuto] = useState(false);
  const busy = commitments(data.board, exceptTripId);
  const trucks = data.trucks.filter((t) => t.is_active !== false || t.id === truckId);
  const drivers = data.drivers.filter((d) => d.is_active !== false || d.id === driverId);
  const truckBusy = truckId ? busy.trucks.get(truckId) : undefined;
  const driverBusy = driverId ? busy.drivers.get(driverId) : undefined;

  function pickTruck(id: string) {
    if (driverId && !driverAuto) return onChange({ truckId: id, driverId });
    const usual = id ? usualDriver(data, id) : null;
    setDriverAuto(!!usual);
    onChange({ truckId: id, driverId: usual ?? "" });
  }

  return (
    <div className="row">
      <div className="field">
        <label htmlFor={`${idPrefix}Truck`}>Truck</label>
        <select id={`${idPrefix}Truck`} value={truckId} onChange={(e) => pickTruck(e.target.value)}>
          <option value="">—</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {[t.fleet_no, t.horse_reg, t.truck_type !== "flatbed" ? t.truck_type : null].filter(Boolean).join(" · ")}
              {busy.trucks.has(t.id) ? ` — on ${busy.trucks.get(t.id)!.map((x) => x.trip_no).join(", ")}` : ""}
            </option>
          ))}
        </select>
        {truckBusy ? <div className="hint warn">Already on {onTrips(truckBusy)}.</div> : null}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}Driver`}>Driver</label>
        <select id={`${idPrefix}Driver`} value={driverId} onChange={(e) => { setDriverAuto(false); onChange({ truckId, driverId: e.target.value }); }}>
          <option value="">—</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
              {busy.drivers.has(d.id) ? ` — on ${busy.drivers.get(d.id)!.map((x) => x.trip_no).join(", ")}` : ""}
            </option>
          ))}
        </select>
        {driverBusy ? (
          <div className="hint warn">Already on {onTrips(driverBusy)}.</div>
        ) : driverAuto && driverId ? (
          <div className="hint">This truck&apos;s usual driver.</div>
        ) : null}
      </div>
    </div>
  );
}

// A draft trip's next step: pick the truck and driver, then allocate.
// Starts from whatever the trip already has, if anything.
function AllocateTrip({
  trip,
  data,
  busy,
  onAllocate,
}: {
  trip: BoardTrip;
  data: BootstrapPayload;
  busy: boolean;
  onAllocate: (truckId: string, driverId: string) => void;
}) {
  const [truckId, setTruckId] = useState(trip.truck_id ?? "");
  const [driverId, setDriverId] = useState(trip.driver_id ?? "");
  return (
    <div className="d-sec">
      <h3>Next step</h3>
      <TruckDriverFields
        idPrefix="a"
        data={data}
        truckId={truckId}
        driverId={driverId}
        exceptTripId={trip.trip_id}
        onChange={(next) => { setTruckId(next.truckId); setDriverId(next.driverId); }}
      />
      <div className="acts">
        <button className="act" type="button" disabled={busy || !truckId || !driverId} onClick={() => onAllocate(truckId, driverId)}>
          Allocate truck
        </button>
      </div>
    </div>
  );
}

type RateInputs = { customerId: string; routeId: string; tonnage: string; volumeCbm: string; commodity: string; loadDate: string };
type TripRate = (RatePick<RateCard> & { price: number | null; qty: number | null; needs: "tonnage" | "volume" | null }) | null;

// The rate card that prices the form as filled in, and its price -- null
// until a per-tonne or per-m³ card has the quantity it needs. Valid on
// the load date, so a rate change takes effect from its own start date.
function rateFor(cards: RateCard[], f: RateInputs, fallbackDate: string): TripRate {
  if (!f.customerId || !f.routeId) return null;
  const pick = pickRateCard(cards, { customerId: f.customerId, routeId: f.routeId, commodity: f.commodity, onDate: f.loadDate || fallbackDate });
  const card = pick.card;
  if (!card) return { ...pick, price: null, qty: null, needs: null };
  const qty = card.rate_basis === "per_tonne" ? parseFloat(f.tonnage) : card.rate_basis === "per_cbm" ? parseFloat(f.volumeCbm) : 1;
  if (!(Number.isFinite(qty) && qty > 0)) {
    return { ...pick, price: null, qty: null, needs: card.rate_basis === "per_tonne" ? "tonnage" : "volume" };
  }
  return { ...pick, price: Math.round(Number(card.rate_amount) * qty * 100) / 100, qty, needs: null };
}

function RateHint({
  rate,
  revenue,
  revenueFrom,
  commodity,
  onDate,
  onUsePrice,
  onChooseCommodity,
}: {
  rate: TripRate;
  revenue: string;
  revenueFrom: "rate" | "typed" | null;
  commodity: string;
  onDate: string;
  onUsePrice: () => void;
  onChooseCommodity: (commodity: string) => void;
}) {
  if (!rate) return null;
  const box = (kind: "good" | "warn", body: ReactNode) => (
    <div className="hint" style={{ color: kind === "good" ? "var(--settled)" : "var(--waiting)", margin: "-8px 0 13px" }}>{body}</div>
  );
  const choices = (buttons: ReactNode) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{buttons}</div>;
  const card = rate.card;

  if (!card) {
    if (rate.ambiguous) {
      return box("warn", <>
        This customer has a different rate for each commodity. Which is it?
        {choices(rate.commodities.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => onChooseCommodity(c)}>{c}</button>
        )))}
      </>);
    }
    const typed = commodity.trim();
    return box("warn",
      typed && rate.commodities.length
        ? `No rate card for ${typed} on this route (rates on file for ${rate.commodities.join(", ")}). Enter the agreed price.`
        : rate.outOfDate
          ? `No rate card for this customer and route is valid on ${onDate}. Enter the agreed price.`
          : "No rate card for this pairing. Enter the agreed price.");
  }

  if (rate.needs) {
    return box("warn", `${m2(card.rate_amount)} per ${rate.needs === "tonnage" ? "tonne" : "m³"}${card.commodity ? " · " + card.commodity : ""} — enter ${rate.needs} to calculate.`);
  }

  const unit = card.rate_basis === "per_tonne" ? "t" : "m³";
  const detail = (card.commodity ? " · " + card.commodity : "")
    + (card.rate_basis === "per_tonne" || card.rate_basis === "per_cbm" ? ` (${m2(card.rate_amount)} × ${rate.qty} ${unit})` : "");
  if (revenue.trim() && Number(revenue) === rate.price) {
    return box("good", `${revenueFrom === "typed" ? "Matches" : "Filled from"} the rate card${detail}`);
  }
  return box("warn", <>
    The rate card price is {m2(rate.price)}{detail}.{revenueFrom === "typed" ? " Your price is kept." : ""}
    {choices(<button type="button" className="chip" onClick={onUsePrice}>Use {m2(rate.price)}</button>)}
  </>);
}
