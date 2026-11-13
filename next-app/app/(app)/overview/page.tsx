"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { durationLabel, m0, m2 } from "@/lib/format";
import { Spinner } from "@/lib/components/Spinner";
import {
  AGING,
  STAGES,
  monthToDate,
  needsAttention,
  readyToInvoice,
  receivables,
  tripCounts,
  tripMoney,
  type Period,
} from "@/lib/dashboard/summary";
import {
  SPANS,
  borderWaits,
  lastMonths,
  marginByRoute,
  monthlyMoney,
  niceMax,
  profitByTruck,
  short,
  spanLabel,
  truckUse,
  type Month,
  type TripCrossing,
} from "@/lib/dashboard/trends";
import type { BootstrapPayload } from "@/lib/types";

// Mirrors CAN_SEE_FINANCE_OVERVIEW (lib/auth/permissions.ts); the
// collections endpoint enforces it.
const FINANCE_ROLES = ["owner", "admin", "finance"];
const ATTENTION_SHOWN = 8;
const INVOICE_ITEMS_SHOWN = 6;

type Collections = { current: number; previous: number; missingRates: string[] };
type Delta = { text: string; tone: "good" | "bad" | "flat" };

// The user's own calendar date -- trip dates are entered as local dates,
// so a UTC date would put late-evening entries in the wrong day.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Change against the comparison period, coloured by whether that direction
// is good news for this figure.
function pctDelta(cur: number, prev: number, upIsGood: boolean): Delta {
  if (prev === 0) return cur === 0 ? { text: "no change", tone: "flat" } : { text: "up from 0", tone: upIsGood ? "good" : "bad" };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { text: "no change", tone: "flat" };
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`, tone: pct > 0 === upIsGood ? "good" : "bad" };
}

function ptsDelta(cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return { text: "no change", tone: "flat" };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pts`, tone: d > 0 ? "good" : "bad" };
}

function Kpi({ label, value, delta, vs, note }: { label: string; value: string; delta?: Delta | null; vs?: string; note?: string }) {
  return (
    <div className="cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {delta ? <div className="n"><span className={"delta " + delta.tone}>{delta.text}</span> vs {vs}</div> : null}
      {note ? <div className="n">{note}</div> : null}
    </div>
  );
}

export default function OverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [day, setDay] = useState("");
  const [collections, setCollections] = useState<Collections | null>(null);
  const [span, setSpan] = useState<number>(6);
  const [crossings, setCrossings] = useState<TripCrossing[] | null>(null);
  const [running, setRunning] = useState<Record<string, number> | null>(null);

  async function load() {
    const res = await fetch("/api/bootstrap");
    if (res.status === 401) return router.push("/login");
    if (!res.ok) return setError("Couldn't load — try refreshing.");
    const payload: BootstrapPayload = await res.json();
    const todayIso = localToday();
    setData(payload);
    setLoadedAt(Date.now());
    setDay(todayIso);
    setError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
    if (FINANCE_ROLES.includes(payload.role)) {
      const { current, previous } = monthToDate(todayIso);
      const qs = new URLSearchParams({ from: current.from, to: current.to, prevFrom: previous.from, prevTo: previous.to });
      const c = await fetch(`/api/dashboard/collections?${qs}`);
      if (c.ok) setCollections(await c.json());
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once
  }, []);

  // Border crossings (everyone) and truck running costs (finance) for the
  // chosen span, refetched when it changes. A late answer for a span that's
  // no longer chosen is dropped.
  const role = data?.role;
  useEffect(() => {
    if (!day || !role) return;
    const months = lastMonths(day, span);
    const from = months[0].from;
    let current = true;
    fetch(`/api/dashboard/borders?from=${from}`)
      .then((r) => (r.ok ? r.json() : { crossings: [] }))
      .then((b) => { if (current) setCrossings(b.crossings); });
    if (FINANCE_ROLES.includes(role)) {
      fetch(`/api/dashboard/truck-costs?${new URLSearchParams({ from, to: day })}`)
        .then((r) => (r.ok ? r.json() : { byTruck: {} }))
        .then((b) => { if (current) setRunning(b.byTruck); });
    }
    return () => { current = false; };
  }, [day, span, role]);

  if (error && !data) return <div className="note bad">{error}</div>;
  if (!data) return <div className="panel"><Spinner /></div>;

  const finance = FINANCE_ROLES.includes(data.role);
  const { current, previous } = monthToDate(day);
  const attention = needsAttention(data.board, loadedAt);

  return (
    <>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="dash-head">
        <h2>Overview</h2>
        <span className="r-mono">This month so far: {current.label} · compared with {previous.label}</span>
      </div>

      {finance ? <FinanceRow data={data} current={current} previous={previous} collections={collections} /> : <OpsRow data={data} current={current} previous={previous} />}

      <div className="dash-grid">
        <section className="panel dash-wide">
          <div className="panel-head">
            <h2>Trips by stage</h2>
            <Link className="act" href="/board">Open Board</Link>
          </div>
          <div className="stage-row">
            {STAGES.map((s) => {
              const n = data.board.filter(s.match).length;
              return (
                <Link key={s.key} href={`/board?filter=${s.filter}`} className={"stage" + (n ? "" : " zero")}>
                  <span className="stage-n">{n}</span>
                  <span className="stage-k">{s.label}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className={"panel" + (finance ? "" : " dash-wide")}>
          <div className="panel-head">
            <h2>Needs attention</h2>
            <span className="r-min">{attention.length ? `${attention.length} item${attention.length > 1 ? "s" : ""}` : ""}</span>
          </div>
          <ul className="list link-list">
            {attention.length ? attention.slice(0, ATTENTION_SHOWN).map((a) => (
              <li key={a.trip.trip_id + a.reason}>
                <Link className="link-row" href={`/board?trip=${a.trip.trip_id}`}>
                  <div>
                    <div className="r-no">{a.trip.trip_no}</div>
                    <div className="r-title" style={{ fontSize: 15 }}>{a.reason}</div>
                    <div className="r-sub">{a.trip.customer} · {a.trip.route}</div>
                  </div>
                  <span className={"pill " + a.severity}>{a.severity === "bad" ? "urgent" : "check"}</span>
                </Link>
              </li>
            )) : <li className="empty">Nothing needs attention right now.</li>}
          </ul>
          {attention.length > ATTENTION_SHOWN ? (
            <div className="panel-body"><Link className="act" href="/board">+{attention.length - ATTENTION_SHOWN} more on the Board</Link></div>
          ) : null}
        </section>

        {finance ? <ReadyToInvoice data={data} /> : null}
        {finance ? <Receivables data={data} /> : null}
      </div>

      <Trends
        data={data}
        months={lastMonths(day, span)}
        span={span}
        onSpan={setSpan}
        finance={finance}
        crossings={crossings}
        running={running}
        now={loadedAt}
      />
    </>
  );
}

function FinanceRow({ data, current, previous, collections }: { data: BootstrapPayload; current: Period; previous: Period; collections: Collections | null }) {
  const now = tripMoney(data.board, current);
  const before = tripMoney(data.board, previous);
  const recv = receivables(data.ar, data.fx);
  return (
    <div className="strip kpi-5">
      <Kpi label="Revenue" value={m0(now.revenue)} delta={pctDelta(now.revenue, before.revenue, true)} vs={previous.label} note={`${now.trips} trip${now.trips === 1 ? "" : "s"} loaded`} />
      <Kpi label="Trip costs" value={m0(now.costs)} delta={pctDelta(now.costs, before.costs, false)} vs={previous.label} />
      <Kpi
        label="Margin"
        value={now.marginPct === null ? "—" : `${now.marginPct.toFixed(1)}%`}
        delta={ptsDelta(now.marginPct, before.marginPct)}
        vs={previous.label}
        note={m0(now.margin)}
      />
      <Kpi
        label="Cash collected"
        value={collections ? m0(collections.current) : "…"}
        delta={collections ? pctDelta(collections.current, collections.previous, true) : null}
        vs={previous.label}
        note={collections?.missingRates.length ? `excludes ${collections.missingRates.join(", ")} (no rate on file)` : undefined}
      />
      <Kpi
        label="Overdue receivables"
        value={m0(recv.overdueTotal)}
        note={recv.overdueCount ? `${recv.overdueCount} invoice${recv.overdueCount === 1 ? "" : "s"} · oldest ${recv.oldestDays} days` : "nothing overdue"}
      />
    </div>
  );
}

function OpsRow({ data, current, previous }: { data: BootstrapPayload; current: Period; previous: Period }) {
  const now = tripCounts(data.board, current);
  const before = tripCounts(data.board, previous);
  const rolling = data.board.filter((t) => ["loading", "in_transit", "at_border"].includes(t.status));
  const late = rolling.filter((t) => t.over_target);
  return (
    <div className="strip">
      <Kpi label="Trips loaded" value={String(now.loaded)} delta={pctDelta(now.loaded, before.loaded, true)} vs={previous.label} />
      <Kpi label="Trips delivered" value={String(now.delivered)} delta={pctDelta(now.delivered, before.delivered, true)} vs={previous.label} />
      <Kpi label="On the road now" value={String(rolling.length)} />
      <Kpi label="Late now" value={String(late.length)} note={late.length ? late.map((t) => t.trip_no).join(", ") : "all on schedule"} />
    </div>
  );
}

function ReadyToInvoice({ data }: { data: BootstrapPayload }) {
  const ready = readyToInvoice(data.billable);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Ready to invoice</h2>
        <Link className="act" href="/billing">Open Billing</Link>
      </div>
      <div className="d-sec">
        <div className="dash-figure">{m0(ready.total)}</div>
        <div className="r-sub">
          {ready.items.length
            ? `${ready.items.length} milestone${ready.items.length === 1 ? "" : "s"} on ${ready.trips} trip${ready.trips === 1 ? "" : "s"} can be invoiced now`
            : "Nothing can be invoiced right now."}
        </div>
      </div>
      {ready.items.length ? (
        <ul className="list link-list">
          {ready.items.slice(0, INVOICE_ITEMS_SHOWN).map((i) => (
            <li key={i.trip_id + i.label}>
              <Link className="link-row" href={`/billing?trip=${i.trip_id}`}>
                <div>
                  <div className="r-no">{i.trip_no}</div>
                  <div className="r-title" style={{ fontSize: 15 }}>{i.customer}</div>
                  <div className="r-sub">{i.label}</div>
                </div>
                <div className="r-amt">{m0(i.amount)}</div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Receivables({ data }: { data: BootstrapPayload }) {
  const recv = receivables(data.ar, data.fx);
  const max = Math.max(0, ...recv.buckets.map((b) => b.amount));
  return (
    <section className="panel dash-wide">
      <div className="panel-head">
        <h2>Receivables</h2>
        <span className="r-min">{m0(recv.total)} unpaid</span>
      </div>
      <div className="recv">
        <div className="aging">
          {AGING.map((a) => {
            const b = recv.buckets.find((x) => x.key === a.key)!;
            return (
              <div key={a.key} className="aging-row" title={`${a.label}: ${m2(b.amount)} across ${b.count} invoice${b.count === 1 ? "" : "s"}`}>
                <span className="aging-k">{a.label}</span>
                <span className="aging-track">
                  {b.amount > 0 ? <span className="aging-bar" style={{ width: `${(b.amount / max) * 100}%` }} /> : null}
                </span>
                <span className="aging-v">{m0(b.amount)}</span>
              </div>
            );
          })}
        </div>
        <div>
          <div className="dash-sub">Who owes the most</div>
          {recv.topCustomers.length ? (
            <ul className="list" style={{ maxHeight: "none" }}>
              {recv.topCustomers.map((c) => (
                <li key={c.customer}>
                  <div>
                    <div className="r-title" style={{ fontSize: 15 }}>{c.customer}</div>
                    <div className="r-sub">
                      {c.invoices} invoice{c.invoices === 1 ? "" : "s"}{c.overdue > 0 ? ` · ${m0(c.overdue)} overdue` : ""}
                    </div>
                  </div>
                  <div className="r-amt">{m0(c.total)}</div>
                </li>
              ))}
            </ul>
          ) : <div className="empty">No unpaid invoices.</div>}
        </div>
      </div>
      {recv.missingRates.length ? (
        <div className="panel-body"><div className="note warn" style={{ marginBottom: 0 }}>Invoices in {recv.missingRates.join(", ")} aren&apos;t included: no exchange rate on file.</div></div>
      ) : null}
    </section>
  );
}

// ---- Trends -------------------------------------------------------------

function Trends({
  data, months, span, onSpan, finance, crossings, running, now,
}: {
  data: BootstrapPayload;
  months: Month[];
  span: number;
  onSpan: (n: number) => void;
  finance: boolean;
  crossings: TripCrossing[] | null;
  running: Record<string, number> | null;
  now: number;
}) {
  const from = months[0].from;
  const to = months[months.length - 1].to;
  return (
    <>
      <div className="dash-head trends-head">
        <h2>Trends</h2>
        <span className="r-mono">{spanLabel(months)}</span>
        <div className="chips trend-spans" role="group" aria-label="Period">
          {SPANS.map((n) => (
            <button key={n} type="button" className={"chip" + (n === span ? " on" : "")} aria-pressed={n === span} onClick={() => onSpan(n)}>
              {n} months
            </button>
          ))}
        </div>
      </div>
      <div className="dash-grid">
        {finance ? <MonthlyChart data={data} months={months} /> : null}
        {finance ? <RouteMargins data={data} from={from} to={to} /> : null}
        {finance ? <TruckProfit data={data} running={running} from={from} to={to} /> : null}
        <BorderWaits data={data} crossings={crossings} from={from} to={to} now={now} />
        <TruckUse data={data} now={now} />
      </div>
    </>
  );
}

function MonthlyChart({ data, months }: { data: BootstrapPayload; months: Month[] }) {
  const [asTable, setAsTable] = useState(false);
  const rows = monthlyMoney(data.board, months);
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => [r.revenue, r.costs])));
  const ticks = [0, max / 2, max];
  const pct = (v: number) => `${(v / max) * 100}%`;
  const total = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, costs: s.costs + r.costs }), { revenue: 0, costs: 0 });
  const totalPct = total.revenue > 0 ? ((total.revenue - total.costs) / total.revenue) * 100 : null;
  return (
    <section className="panel dash-wide">
      <div className="panel-head mchart-head">
        <h2>Revenue and costs by month</h2>
        <div className="mchart-tools">
          {asTable ? null : (
            <span className="mchart-legend">
              <span><i className="mkey rev" /> Revenue</span>
              <span><i className="mkey cost" /> Trip costs</span>
            </span>
          )}
          <button type="button" className="act" onClick={() => setAsTable(!asTable)}>{asTable ? "Chart" : "Table"}</button>
        </div>
      </div>
      <div className="d-sec mchart-total">
        <span>{m0(total.revenue - total.costs)} margin on {m0(total.revenue)} revenue{totalPct === null ? "" : ` · ${totalPct.toFixed(1)}%`}</span>
        <span className="r-mono">USD · by month loaded</span>
      </div>
      {asTable ? (
        <div className="mtable-wrap">
          <table className="mtable">
            <thead><tr><th>Month</th><th>Trips</th><th>Revenue</th><th>Trip costs</th><th>Margin</th><th>Margin %</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}{r.soFar ? " (to date)" : ""}</td>
                  <td>{r.trips}</td>
                  <td>{m0(r.revenue)}</td>
                  <td>{m0(r.costs)}</td>
                  <td className={r.margin < 0 ? "neg" : ""}>{m0(r.margin)}</td>
                  <td className={r.margin < 0 ? "neg" : ""}>{r.marginPct === null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mchart">
          <div className="mchart-y" aria-hidden="true">
            {ticks.map((t) => <span key={t} style={{ bottom: pct(t) }}>{short(t)}</span>)}
          </div>
          <div className="mchart-plot" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
            {ticks.map((t) => <span key={t} className="mgrid" style={{ bottom: pct(t) }} />)}
            {rows.map((r) => {
              const label = `${r.label}${r.soFar ? " (to date)" : ""}: revenue ${m0(r.revenue)}, trip costs ${m0(r.costs)}, margin ${m0(r.margin)}${r.marginPct === null ? "" : ` (${r.marginPct.toFixed(1)}%)`}, ${r.trips} trip${r.trips === 1 ? "" : "s"}`;
              return (
                <div key={r.key} className="mcol" title={label} aria-label={label} role="img">
                  {r.revenue > 0 ? <span className="mbar rev" style={{ height: pct(r.revenue) }} /> : <span className="mbar none" />}
                  {r.costs > 0 ? <span className="mbar cost" style={{ height: pct(r.costs) }} /> : <span className="mbar none" />}
                </div>
              );
            })}
          </div>
          <span />
          <div className="mchart-x" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
            {rows.map((r) => (
              <div key={r.key}>
                <span className="mx-month">{r.label}{r.soFar ? <span className="mx-sofar"> so far</span> : null}</span>
                <span className={"mx-margin" + (r.margin < 0 ? " neg" : "")}>{r.marginPct === null ? "—" : `${r.marginPct.toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type BarRow = { key: string; title: string; sub: string; value: number; valueText: string; href?: string; pill?: string };

// Rows with one thin bar each, on a shared scale from a common baseline.
// A negative value (a loss) is drawn hatched and its figure marked.
function BarRows({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value))) || 1;
  return (
    <ul className="list link-list bar-rows">
      {rows.map((r) => {
        const body = (
          <>
            <div className="bar-label">
              <div className="r-title" style={{ fontSize: 15 }}>{r.title}{r.pill ? <span className="pill warn">{r.pill}</span> : null}</div>
              <div className="r-sub">{r.sub}</div>
            </div>
            <span className="bar-track">
              {r.value !== 0 ? <span className={"bar" + (r.value < 0 ? " loss" : "")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /> : null}
            </span>
            <span className={"bar-v" + (r.value < 0 ? " neg" : "")}>{r.valueText}</span>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? <Link className="link-row bar-row" href={r.href}>{body}</Link> : <div className="bar-row">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function RouteMargins({ data, from, to }: { data: BootstrapPayload; from: string; to: string }) {
  const routes = marginByRoute(data.board, from, to);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Margin by route</h2>
        <span className="r-min">trip revenue less trip costs</span>
      </div>
      <BarRows
        empty="No trips loaded in this period."
        rows={routes.map((r) => ({
          key: r.route_id,
          title: r.route,
          sub: `${plural(r.trips, "trip")} · ${m0(r.perTrip)} a trip${r.marginPct === null ? "" : ` · ${r.marginPct.toFixed(1)}%`}`,
          value: r.margin,
          valueText: m0(r.margin),
        }))}
      />
    </section>
  );
}

function TruckProfit({ data, running, from, to }: { data: BootstrapPayload; running: Record<string, number> | null; from: string; to: string }) {
  if (!running) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>Profit per truck</h2></div>
        <Spinner />
      </section>
    );
  }
  const { rows, tripsWithoutTruck } = profitByTruck(data.board, data.trucks, running, from, to);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Profit per truck</h2>
        <span className="r-min">trip margin less running costs</span>
      </div>
      <BarRows
        empty="No trucks yet."
        rows={rows.map((r) => ({
          key: r.truck.id,
          title: `${r.truck.fleet_no} · ${r.truck.horse_reg}`,
          sub: `${plural(r.trips, "trip")} · ${m0(r.tripMargin)} trip margin · ${m0(r.running)} running`,
          value: r.profit,
          valueText: m0(r.profit),
          href: `/reports?${new URLSearchParams({ truck: r.truck.id, from, to })}`,
        }))}
      />
      <div className="panel-body bar-note">
        Running costs are maintenance, insurance, tyres and the like; purchase costs are left out (see the truck report&apos;s breakeven).
        {tripsWithoutTruck ? ` ${plural(tripsWithoutTruck, "trip")} with no truck assigned ${tripsWithoutTruck === 1 ? "isn't" : "aren't"} counted.` : ""}
      </div>
    </section>
  );
}

function BorderWaits({ data, crossings, from, to, now }: { data: BootstrapPayload; crossings: TripCrossing[] | null; from: string; to: string; now: number }) {
  if (!crossings) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>Border waiting times</h2></div>
        <Spinner />
      </section>
    );
  }
  const borders = borderWaits(crossings, data.board, from, to, now);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Border waiting times</h2>
        <span className="r-min">arrival to clearance, average</span>
      </div>
      <BarRows
        empty="No border crossings logged in this period."
        rows={borders.map((b) => ({
          key: b.border,
          title: b.border,
          sub: b.crossings
            ? `${plural(b.crossings, "crossing")} · longest ${durationLabel(b.longestHours! * 3_600_000)}`
            : "No crossings cleared in this period",
          value: b.avgHours ?? 0,
          valueText: b.avgHours === null ? "—" : durationLabel(b.avgHours * 3_600_000),
          pill: b.waitingNow ? `${b.waitingNow} waiting, ${durationLabel(b.longestNowHours! * 3_600_000)}` : undefined,
        }))}
      />
    </section>
  );
}

function TruckUse({ data, now }: { data: BootstrapPayload; now: number }) {
  const use = truckUse(data.board, data.trucks, now);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Trucks</h2>
        <span className="r-min">right now · {plural(use.active, "active truck")}</span>
      </div>
      <div className="truck-use">
        <div><span className="stage-n">{use.onTrip.length}</span><span className="stage-k">On a trip</span></div>
        <div><span className="stage-n">{use.booked.length}</span><span className="stage-k">Booked</span></div>
        <div><span className="stage-n">{use.free.length}</span><span className="stage-k">Free</span></div>
      </div>
      {use.free.length ? (
        <ul className="list" style={{ maxHeight: "none" }}>
          {use.free.map((f) => (
            <li key={f.truck.id}>
              <div>
                <div className="r-title" style={{ fontSize: 15 }}>{f.truck.fleet_no} · {f.truck.horse_reg}</div>
                <div className="r-sub">{f.lastTrip ? `Last trip ${f.lastTrip}, delivered ${day(f.since!)}` : "No trips yet"}</div>
              </div>
              <div className="r-amt">{f.days === null ? "—" : f.days === 0 ? "today" : `${f.days} day${f.days === 1 ? "" : "s"} free`}</div>
            </li>
          ))}
        </ul>
      ) : <div className="empty">Every active truck is on a trip or booked.</div>}
    </section>
  );
}
