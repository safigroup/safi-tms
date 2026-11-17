"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { m0, m2 } from "@/lib/format";
import type { BandFig } from "@/lib/components/PageBand";
import { customerWords, routeWords, truckWords } from "@/lib/reports/compareWords";
import type { Line } from "@/lib/reports/summary";
import type { CompareCustomer, CompareMoney, CompareReport, CompareRoute, CompareTruck } from "@/lib/types";

// The Reports page's side-by-side views: every truck, every route and
// every customer over the chosen period, each as a few plain sentences,
// bars for the one figure that matters most, and a table to sort.

export type CompareView = "trucks" | "routes" | "customers";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const signed = (n: number) => (n <= -0.5 ? `−${m0(-n)}` : m0(Math.max(0, n)));
const tone = (n: number) => (n <= -0.5 ? "neg" : n >= 0.5 ? "pos" : "");
// The same for amounts in cents (per km).
const centsTone = (n: number) => (n <= -0.005 ? "neg" : n >= 0.005 ? "pos" : "");

function totals(rows: CompareMoney[]) {
  return {
    trips: sum(rows, (r) => r.trips),
    revenue: sum(rows, (r) => r.revenue),
    tripCosts: sum(rows, (r) => r.tripCosts),
    invoiced: sum(rows, (r) => r.invoiced),
    collected: sum(rows, (r) => r.collected),
    overdue: sum(rows, (r) => r.overdue),
  };
}

// The band's headline for each view.
export function compareTitle(view: CompareView, c: CompareReport) {
  if (view === "trucks") {
    const profit = sum(c.trucks, (r) => r.profit);
    if (!c.trucks.some((r) => r.trips > 0 || r.owningCosts > 0)) return "Nothing recorded yet";
    return profit <= -0.5 ? `The fleet lost ${m0(-profit)}` : `The fleet made ${m0(profit)}`;
  }
  const t = totals(view === "routes" ? c.routes : c.customers);
  if (!t.trips) return "No trips in this period";
  return view === "routes"
    ? `${plural(t.trips, "trip")} on ${plural(c.routes.length, "route")}`
    : `${plural(t.trips, "trip")} for ${plural(c.customers.length, "customer")}`;
}

export function compareFigs(view: CompareView, c: CompareReport): BandFig[] {
  const share = (part: number, whole: number) => {
    const p = pctOf(part, whole);
    return p === null ? undefined : `${p}% of revenue`;
  };
  const fig = (key: string, k: string, v: string, n?: string, t?: BandFig["tone"], title?: string): BandFig => ({ key, k, v, n, tone: t, title });
  if (view === "trucks") {
    const t = totals(c.trucks);
    const owning = sum(c.trucks, (r) => r.owningCosts);
    const profit = t.revenue - t.tripCosts - owning;
    return [
      fig("rev", "Revenue", m0(t.revenue), `${plural(t.trips, "trip")} · ${plural(c.trucks.length, "truck")}`),
      fig("trip", "Trip costs", m0(t.tripCosts), share(t.tripCosts, t.revenue), undefined, "What the trips cost to run: fuel, border fees, driver allowances and the like."),
      fig("own", "Owning costs", m0(owning), share(owning, t.revenue), undefined, "What the trucks cost to keep, working or not: insurance, tyres, repairs, licences."),
      fig("net", profit <= -0.5 ? "Loss" : "Profit", m0(Math.abs(profit)), profit > 0 ? share(profit, t.revenue) : undefined, profit <= -0.5 ? "bad" : profit >= 0.5 ? "pos" : undefined),
      fig("paid", "Collected", m0(t.collected), [share(t.collected, t.revenue), t.overdue >= 0.5 ? `${m0(t.overdue)} overdue` : null].filter(Boolean).join(" · ") || undefined),
    ];
  }
  if (view === "routes") {
    const t = totals(c.routes);
    const left = t.revenue - t.tripCosts;
    const late = sum(c.routes, (r) => r.late);
    return [
      fig("rev", "Revenue", m0(t.revenue), plural(t.trips, "trip")),
      fig("trip", "Trip costs", m0(t.tripCosts), share(t.tripCosts, t.revenue)),
      fig("left", "Left after trip costs", signed(left), left > 0 ? share(left, t.revenue) : undefined, left <= -0.5 ? "bad" : left >= 0.5 ? "pos" : undefined),
      fig("late", "Late trips", `${late} of ${t.trips}`, "against each route's target", late ? "warn" : undefined),
    ];
  }
  const t = totals(c.customers);
  return [
    fig("rev", "Revenue", m0(t.revenue), plural(t.trips, "trip")),
    fig("inv", "Invoiced", m0(t.invoiced), share(t.invoiced, t.revenue)),
    fig("paid", "Collected", m0(t.collected), share(t.collected, t.revenue), t.collected >= 0.5 ? "pos" : undefined),
    fig("late", "Overdue", m0(t.overdue), t.overdue >= 0.5 ? "past its due date" : "nothing overdue", t.overdue >= 0.5 ? "bad" : undefined),
  ];
}

type Col<T> = {
  key: string;
  label: string;
  // What the column sorts by; null sorts last.
  value: (r: T) => number | string | null;
  cell: (r: T) => ReactNode;
  total?: ReactNode;
  title?: string;
};

function Cell({ main, sub, className }: { main: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <>
      <span className={"cell-main" + (className ? " " + className : "")}>{main}</span>
      {sub ? <span className="cell-sub">{sub}</span> : null}
    </>
  );
}

// A table sorted by clicking its headings (again to reverse). Text sorts
// A to Z first, figures largest first. Each view gives its table its own
// key, so a sort picked on one view doesn't carry over to the next. With `onOpen` each row opens, by a
// click anywhere on it or by its first cell's button.
function SortTable<T>({
  cols, rows, rowKey, initial, onOpen, foot,
}: {
  cols: Col<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  initial: string;
  onOpen?: (r: T) => void;
  foot?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 });
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return d * sort.dir;
  });
  const pick = (c: Col<T>, i: number) =>
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: i === 0 ? 1 : -1 }));
  return (
    <>
      <div className="table-hint">Swipe the table sideways to see every column.</div>
      <div className="mtable-wrap">
        <table className="mtable ctable">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} title={c.title} aria-sort={c.key === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => pick(c, i)}>
                    {c.label}
                    <span className="sort-mark" aria-hidden="true">{c.key === sort.key ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)} className={onOpen ? "tap" : undefined} onClick={onOpen ? () => onOpen(r) : undefined}>
                {cols.map((c, i) => (
                  <td key={c.key}>
                    {i === 0 && onOpen ? (
                      <button type="button" className="cell-open" onClick={(e) => { e.stopPropagation(); onOpen(r); }}>{c.cell(r)}</button>
                    ) : c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {foot ? (
            <tfoot>
              <tr>{cols.map((c) => <td key={c.key}>{c.total ?? ""}</td>)}</tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </>
  );
}

type Bar = { key: string; label: string; sub: string; value: number; text: string };

// One thin bar a row on a shared scale, a loss hatched (the Overview's bars).
function Bars({ title, rows }: { title: string; rows: Bar[] }) {
  if (!rows.length) return null;
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value))) || 1;
  return (
    <div className="cmp-bars">
      <div className="dash-sub cmp-bars-head">{title}</div>
      <ul className="list bar-rows">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="bar-row">
              <div className="bar-label">
                <div className="r-title" style={{ fontSize: 14.5 }}>{r.label}</div>
                <div className="r-sub">{r.sub}</div>
              </div>
              <span className="bar-track">
                {Math.abs(r.value) >= 0.5 ? <span className={"bar" + (r.value < 0 ? " loss" : "")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /> : null}
              </span>
              <span className={"bar-v" + (r.value <= -0.5 ? " neg" : "")}>{r.text}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Words({ lines, bars }: { lines: Line[]; bars: ReactNode }) {
  return (
    <section className="panel dash-wide">
      <div className="panel-head">
        <h2>In short</h2>
        <span className="r-min">worked out from the figures on this page</span>
      </div>
      <div className="short">
        <ul className="short-lines">
          {lines.map((l) => (
            <li key={l.key} className={l.tone}>
              <span className="short-dot" aria-hidden="true" />
              <p><strong>{l.lead}</strong> {l.text}</p>
            </li>
          ))}
        </ul>
        {bars}
      </div>
    </section>
  );
}

const pctCell = (part: number, whole: number) => {
  const p = pctOf(part, whole);
  return p === null ? "—" : `${p}%`;
};

export function CompareBody({ view, c, onTruck }: { view: CompareView; c: CompareReport; onTruck: (id: string) => void }) {
  const ratesNote = c.paymentRatesMissing.length ? (
    <div className="note warn" style={{ margin: "12px 18px 0" }}>
      Invoices in {c.paymentRatesMissing.join(", ")} aren&apos;t in the invoiced and collected figures: no exchange rate on file.
    </div>
  ) : null;

  if (view === "trucks") {
    const rows = c.trucks;
    const t = totals(rows);
    const owning = sum(rows, (r) => r.owningCosts);
    const profit = t.revenue - t.tripCosts - owning;
    const km = sum(rows, (r) => r.km);
    const allKm = rows.every((r) => r.kmKnown);
    const perKm = (r: CompareTruck) => (r.kmKnown && r.km > 0 ? r.profit / r.km : null);
    const dayShare = (r: CompareTruck) => (r.days ? (r.daysOnTrip ?? 0) / r.days : null);
    const cols: Col<CompareTruck>[] = [
      { key: "truck", label: "Truck", value: (r) => r.truck.fleet_no, cell: (r) => <Cell main={r.truck.fleet_no} sub={r.truck.horse_reg + (r.truck.is_active ? "" : " · inactive")} />, total: <Cell main="Fleet" sub={plural(rows.length, "truck")} /> },
      { key: "trips", label: "Trips", value: (r) => r.trips, cell: (r) => r.trips, total: t.trips },
      { key: "rev", label: "Revenue", value: (r) => r.revenue, cell: (r) => m0(r.revenue), total: m0(t.revenue) },
      { key: "trip", label: "Trip costs", value: (r) => r.tripCosts, cell: (r) => m0(r.tripCosts), total: m0(t.tripCosts) },
      { key: "own", label: "Owning costs", value: (r) => r.owningCosts, cell: (r) => m0(r.owningCosts), total: m0(owning), title: "Insurance, tyres, repairs and the like. Buying the truck isn't counted." },
      {
        key: "profit", label: "Profit", value: (r) => r.profit,
        cell: (r) => <Cell main={signed(r.profit)} className={tone(r.profit)} sub={r.revenue > 0 ? `${pctCell(r.profit, r.revenue)} of revenue` : undefined} />,
        total: <Cell main={signed(profit)} className={tone(profit)} sub={t.revenue > 0 ? `${pctCell(profit, t.revenue)} of revenue` : undefined} />,
      },
      {
        key: "km", label: "Per km", value: perKm, title: "Profit per km driven: each route one way, twice when the trip logged an empty return.",
        cell: (r) => (perKm(r) === null ? <Cell main="—" sub={r.trips && !r.kmKnown ? "distance missing" : undefined} /> : <Cell main={(perKm(r)! < 0 ? "−" : "") + m2(Math.abs(perKm(r)!))} className={centsTone(perKm(r)!)} sub={`${Math.round(r.km).toLocaleString("en-US")} km`} />),
        total: allKm && km > 0 ? <Cell main={(profit < 0 ? "−" : "") + m2(Math.abs(profit / km))} sub={`${Math.round(km).toLocaleString("en-US")} km`} /> : "—",
      },
      {
        key: "days", label: "Days with a load", value: dayShare, title: "Days from loading to delivery, out of the period's days since the truck's first day.",
        cell: (r) => (r.days ? <Cell main={`${Math.round(dayShare(r)! * 100)}%`} sub={`${r.daysOnTrip} of ${plural(r.days, "day")}`} /> : "—"),
      },
      {
        key: "paid", label: "Collected", value: (r) => (r.revenue > 0 ? r.collected / r.revenue : null),
        cell: (r) => (r.revenue > 0 ? <Cell main={pctCell(r.collected, r.revenue)} sub={m0(r.collected)} /> : "—"),
        total: t.revenue > 0 ? <Cell main={pctCell(t.collected, t.revenue)} sub={m0(t.collected)} /> : "—",
      },
      { key: "late", label: "Overdue", value: (r) => r.overdue, cell: (r) => (r.overdue >= 0.5 ? <span className="neg">{m0(r.overdue)}</span> : "—"), total: t.overdue >= 0.5 ? <span className="neg">{m0(t.overdue)}</span> : "—" },
    ];
    const ranked = [...rows].sort((a, b) => b.profit - a.profit).slice(0, 6);
    return (
      <>
        <Words
          lines={truckWords(c)}
          bars={<Bars title="Profit by truck" rows={ranked.map((r) => ({ key: r.truck.id, label: r.truck.fleet_no, sub: plural(r.trips, "trip"), value: r.profit, text: signed(r.profit) }))} />}
        />
        <section className="panel dash-wide cmp-table">
          <div className="panel-head">
            <h2>All trucks</h2>
            <span className="r-min">open a truck for its full report</span>
          </div>
          <SortTable key="trucks" cols={cols} rows={rows} rowKey={(r) => r.truck.id} initial="profit" onOpen={(r) => onTruck(r.truck.id)} foot />
          {ratesNote}
          <div className="panel-body bar-note">
            Profit is revenue less trip costs and owning costs; what a truck cost to buy isn&apos;t counted (see its payback in its own report).
            {c.tripsWithoutTruck ? ` ${plural(c.tripsWithoutTruck, "trip")} with no truck assigned ${c.tripsWithoutTruck === 1 ? "isn't" : "aren't"} counted here.` : ""}
          </div>
        </section>
      </>
    );
  }

  if (view === "routes") {
    const rows = c.routes;
    const t = totals(rows);
    const left = (r: CompareRoute) => r.revenue - r.tripCosts;
    const late = sum(rows, (r) => r.late);
    const cols: Col<CompareRoute>[] = [
      { key: "route", label: "Route", value: (r) => r.name, cell: (r) => <Cell main={r.name} sub={r.km ? `${r.km.toLocaleString("en-US")} km one way` : "no distance set"} />, total: <Cell main="All routes" sub={plural(rows.length, "route")} /> },
      { key: "trips", label: "Trips", value: (r) => r.trips, cell: (r) => <Cell main={r.trips} sub={plural(r.trucks, "truck")} />, total: t.trips },
      { key: "rev", label: "Revenue", value: (r) => r.revenue, cell: (r) => m0(r.revenue), total: m0(t.revenue) },
      { key: "trip", label: "Trip costs", value: (r) => r.tripCosts, cell: (r) => m0(r.tripCosts), total: m0(t.tripCosts) },
      {
        key: "left", label: "Left over", value: left, title: "Revenue less trip costs. Owning costs belong to trucks, not routes.",
        cell: (r) => <Cell main={signed(left(r))} className={tone(left(r))} sub={r.revenue > 0 ? `${pctCell(left(r), r.revenue)} of revenue` : undefined} />,
        total: <Cell main={signed(t.revenue - t.tripCosts)} className={tone(t.revenue - t.tripCosts)} sub={t.revenue > 0 ? `${pctCell(t.revenue - t.tripCosts, t.revenue)} of revenue` : undefined} />,
      },
      { key: "each", label: "A trip", value: (r) => left(r) / r.trips, cell: (r) => <span className={tone(left(r))}>{signed(left(r) / r.trips)}</span>, total: t.trips ? signed((t.revenue - t.tripCosts) / t.trips) : "—", title: "Left over per trip." },
      {
        key: "days", label: "Days a trip", value: (r) => r.avgDays,
        cell: (r) => <Cell main={r.avgDays === null ? "—" : r.avgDays.toFixed(1)} sub={r.targetDays ? `target ${r.targetDays}` : undefined} />,
        title: "Loading to delivery, over the delivered trips.",
      },
      { key: "late", label: "Late", value: (r) => r.late / r.trips, cell: (r) => <span className={r.late ? "neg" : ""}>{`${r.late} of ${r.trips}`}</span>, total: `${late} of ${t.trips}` },
      {
        key: "paid", label: "Collected", value: (r) => (r.revenue > 0 ? r.collected / r.revenue : null),
        cell: (r) => (r.revenue > 0 ? <Cell main={pctCell(r.collected, r.revenue)} sub={m0(r.collected)} /> : "—"),
        total: t.revenue > 0 ? <Cell main={pctCell(t.collected, t.revenue)} sub={m0(t.collected)} /> : "—",
      },
    ];
    const ranked = [...rows].sort((a, b) => left(b) / b.trips - left(a) / a.trips).slice(0, 8);
    return (
      <>
        <Words
          lines={routeWords(c)}
          bars={<Bars title="Left over per trip" rows={ranked.map((r) => ({ key: r.id, label: r.name, sub: plural(r.trips, "trip"), value: left(r) / r.trips, text: signed(left(r) / r.trips) }))} />}
        />
        <section className="panel dash-wide cmp-table">
          <div className="panel-head">
            <h2>Routes</h2>
            <span className="r-min">trips loaded in this period</span>
          </div>
          {rows.length ? <SortTable key="routes" cols={cols} rows={rows} rowKey={(r) => r.id} initial="left" foot /> : <div className="empty">No trips loaded in this period.</div>}
          {ratesNote}
          <div className="panel-body bar-note">
            Left over is revenue less trip costs. Owning costs (insurance, tyres and the like) belong to trucks, so they&apos;re under All trucks.
            {" "}Distances are set under <Link href="/admin">Admin → Routes</Link>.
          </div>
        </section>
      </>
    );
  }

  const rows = c.customers;
  const t = totals(rows);
  const left = (r: CompareCustomer) => r.revenue - r.tripCosts;
  const notInvoiced = (r: CompareMoney) => Math.max(0, r.revenue - r.invoiced);
  const unpaid = (r: CompareMoney) => Math.max(0, r.invoiced - r.collected);
  const cols: Col<CompareCustomer>[] = [
    { key: "customer", label: "Customer", value: (r) => r.name, cell: (r) => <Cell main={r.name} sub={plural(r.trips, "trip")} />, total: <Cell main="All customers" sub={plural(rows.length, "customer")} /> },
    { key: "rev", label: "Revenue", value: (r) => r.revenue, cell: (r) => <Cell main={m0(r.revenue)} sub={t.revenue > 0 ? `${pctCell(r.revenue, t.revenue)} of all` : undefined} />, total: m0(t.revenue) },
    { key: "trip", label: "Trip costs", value: (r) => r.tripCosts, cell: (r) => m0(r.tripCosts), total: m0(t.tripCosts) },
    {
      key: "left", label: "Left over", value: left, title: "Revenue less trip costs.",
      cell: (r) => <Cell main={signed(left(r))} className={tone(left(r))} sub={r.revenue > 0 ? `${pctCell(left(r), r.revenue)} of revenue` : undefined} />,
      total: <Cell main={signed(t.revenue - t.tripCosts)} className={tone(t.revenue - t.tripCosts)} />,
    },
    { key: "notinv", label: "Not invoiced", value: notInvoiced, cell: (r) => (notInvoiced(r) >= 0.5 ? m0(notInvoiced(r)) : "—"), total: m0(sum(rows, notInvoiced)), title: "Earned on these trips but not invoiced yet." },
    { key: "inv", label: "Invoiced", value: (r) => r.invoiced, cell: (r) => m0(r.invoiced), total: m0(t.invoiced) },
    {
      key: "paid", label: "Collected", value: (r) => r.collected,
      cell: (r) => <Cell main={m0(r.collected)} sub={r.revenue > 0 ? `${pctCell(r.collected, r.revenue)} of revenue` : undefined} />,
      total: <Cell main={m0(t.collected)} sub={t.revenue > 0 ? `${pctCell(t.collected, t.revenue)} of revenue` : undefined} />,
    },
    { key: "unpaid", label: "Unpaid", value: unpaid, cell: (r) => (unpaid(r) >= 0.5 ? m0(unpaid(r)) : "—"), total: m0(sum(rows, unpaid)), title: "Invoiced and not paid yet, overdue or not." },
    { key: "late", label: "Overdue", value: (r) => r.overdue, cell: (r) => (r.overdue >= 0.5 ? <span className="neg">{m0(r.overdue)}</span> : "—"), total: t.overdue >= 0.5 ? <span className="neg">{m0(t.overdue)}</span> : "—" },
  ];
  const ranked = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  return (
    <>
      <Words
        lines={customerWords(c)}
        bars={<Bars title="Revenue by customer" rows={ranked.map((r) => ({ key: r.id, label: r.name, sub: `${plural(r.trips, "trip")} · ${pctCell(r.collected, r.revenue)} collected`, value: r.revenue, text: m0(r.revenue) }))} />}
      />
      <section className="panel dash-wide cmp-table">
        <div className="panel-head">
          <h2>Customers</h2>
          <Link className="act sm" href="/billing">Open Billing</Link>
        </div>
        {rows.length ? <SortTable key="customers" cols={cols} rows={rows} rowKey={(r) => r.id} initial="rev" foot /> : <div className="empty">No trips loaded in this period.</div>}
        {ratesNote}
        <div className="panel-body bar-note">
          Only the revenue of trips loaded in this period: what it came to, how much has been invoiced and paid so far, and what&apos;s past its due date.
        </div>
      </section>
    </>
  );
}
