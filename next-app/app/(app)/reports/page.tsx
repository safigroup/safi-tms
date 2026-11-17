"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, num, lab, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import { PageBand, type BandFig } from "@/lib/components/PageBand";
import { betterWorse, kpi, pctDelta } from "@/lib/components/bandFigs";
import { MonthlyChart } from "@/lib/components/MonthlyChart";
import { TripLedgerBody } from "@/lib/components/TripLedgerBody";
import { t, catLabel, type PrintLang } from "@/lib/print/translations";
import { CAPITAL_CATEGORIES, NON_CASH_CATEGORIES } from "@/lib/trucks/costs";
import { RANGES, dayLabel, resolveRange, type RangeKey, type ReportRange } from "@/lib/reports/periods";
import { headline, isEmpty, plainWords } from "@/lib/reports/summary";
import { collectionFigures, dataChecks, payState, tripRows, unitFigures, type Check, type Flag, type TripRow, type Units } from "@/lib/reports/detail";
import { CompareBody, compareFigs, compareTitle, type CompareView } from "./compare-views";
import type { BootstrapPayload, Breakeven, CategoryAmount, CompareReport, TruckReport } from "@/lib/types";
import { useCompanyTimeZone } from "@/lib/components/CompanyTimeZone";
import { CashAccountField, useCashAccountChoice } from "@/lib/components/CashAccountField";

// Mirrors lib/auth/permissions.ts's CAN_EDIT_COMMERCIAL -- UI convenience
// only (hides actions a role can't use), the route handlers are the real check.
const CAN_EDIT_COMMERCIAL = ["owner", "admin", "finance"];

// What a truck costs to keep, then what it cost to buy. Owning costs come
// first so a new entry doesn't default to a purchase.
const OWNING_CATS = ["maintenance", "repairs", "tyres", "insurance", "licensing", "depreciation", "other"];
const BUYING_CATS = ["purchase", "clearing", "registration"];

// Accounting convention, kept for the printed report: a loss is shown in
// parentheses rather than with a leading minus sign.
const pl = (n: number) => (n < 0 ? "(" + m2(Math.abs(n)) + ")" : m2(n));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// One truck's report, or every truck, route or customer side by side.
type View = "truck" | CompareView;
const VIEWS: { key: View; label: string; kicker: string }[] = [
  { key: "truck", label: "One truck", kicker: "Reports · truck report" },
  { key: "trucks", label: "All trucks", kicker: "Reports · all trucks" },
  { key: "routes", label: "Routes", kicker: "Reports · routes" },
  { key: "customers", label: "Customers", kicker: "Reports · customers" },
];

const validDate = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "");

export default function ReportsPage() {
  const router = useRouter();
  // "This month" and the like are the company's calendar, the one trip
  // dates are entered in -- not UTC, and not the viewer's own clock.
  const timeZone = useCompanyTimeZone();
  // ?truck=&from=&to= open one truck's report for a period (the Overview's
  // profit-per-truck rows link here).
  const searchParams = useSearchParams();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [truckId, setTruckId] = useState<string | null>(() => searchParams.get("truck"));
  const [from, setFrom] = useState(() => validDate(searchParams.get("from")));
  const [to, setTo] = useState(() => validDate(searchParams.get("to")));
  const [rangeKey, setRangeKey] = useState<RangeKey>(() =>
    validDate(searchParams.get("from")) || validDate(searchParams.get("to")) ? "custom" : "year",
  );
  const [report, setReport] = useState<TruckReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printLang, setPrintLang] = useState<PrintLang>("en");
  const [includeLedgers, setIncludeLedgers] = useState(false);
  // ?view= opens a side-by-side view (trucks, routes, customers) directly.
  const [view, setView] = useState<View>(() => VIEWS.find((v) => v.key === searchParams.get("view"))?.key ?? "truck");
  const [compare, setCompare] = useState<CompareReport | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  // Count report requests, so an answer that arrives after a newer one
  // was asked for is dropped.
  const requests = useRef(0);
  const compareRequests = useRef(0);

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
    setDay(today(timeZone));
    setLoadError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
    // A truck from the link is kept only if it's one of this org's.
    if (payload.trucks.length) {
      setTruckId((cur) => (cur && payload.trucks.some((t) => t.id === cur) ? cur : payload.trucks[0].id));
    }
  }

  const range = day ? resolveRange(rangeKey, day, { from, to }) : null;

  async function loadReport(id: string, r: ReportRange) {
    const mine = ++requests.current;
    setLoadingReport(true);
    setReportError(null);
    const qs = new URLSearchParams();
    if (r.from) qs.set("from", r.from);
    if (r.to) qs.set("to", r.to);
    if (r.previous) {
      qs.set("prevFrom", r.previous.from);
      qs.set("prevTo", r.previous.to);
    }
    if (includeLedgers) qs.set("includeLedgers", "1");
    const res = await fetch(`/api/reports/trucks/${id}?${qs.toString()}`);
    if (mine !== requests.current) return;
    setLoadingReport(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setReportError(body.error || res.statusText);
      setReport(null);
      return;
    }
    setReport(await res.json());
  }

  // The three side-by-side views share one answer: switching between them
  // doesn't refetch, changing the period does.
  async function loadCompare(r: ReportRange) {
    const mine = ++compareRequests.current;
    setLoadingCompare(true);
    setCompareError(null);
    const qs = new URLSearchParams();
    if (r.from) qs.set("from", r.from);
    if (r.to) qs.set("to", r.to);
    const res = await fetch(`/api/reports/compare?${qs.toString()}`);
    if (mine !== compareRequests.current) return;
    setLoadingCompare(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setCompareError(body.error || res.statusText);
      setCompare(null);
      return;
    }
    setCompare(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load is recreated every render, adding it here would refetch on every render too
  }, []);

  const oneTruck = view === "truck";
  useEffect(() => {
    if (!oneTruck || !truckId || !range) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetching the report when the selected truck, period, or ledger toggle changes
    loadReport(truckId, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only the view, the truck, the period's dates (and the dates it's compared with) and the ledger toggle should trigger a refetch
  }, [oneTruck, truckId, range?.from, range?.to, range?.previous?.from, range?.previous?.to, includeLedgers]);

  useEffect(() => {
    if (oneTruck || !range) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetching the side-by-side figures when the period changes
    loadCompare(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only leaving the one-truck view and the period's dates should trigger a refetch
  }, [oneTruck, range?.from, range?.to]);

  useEffect(() => {
    if (printing) window.print();
  }, [printing]);

  if (!data) return <div className="panel"><Spinner /></div>;

  const canEdit = CAN_EDIT_COMMERCIAL.includes(data.role);
  const truck = data.trucks.find((t) => t.id === truckId) ?? null;
  const shown = report && range && !loadingReport ? report : null;
  const verdict = shown ? headline(shown) : null;
  const preset = RANGES.find((r) => r.key === rangeKey);
  const periodLabel = range ? [preset && !["all", "custom"].includes(preset.key) ? preset.label : null, range.label].filter(Boolean).join(" · ") : undefined;
  const compared = !oneTruck && compare && range && !loadingCompare ? compare : null;

  function openTruck(id: string) {
    setTruckId(id);
    setView("truck");
    window.scrollTo({ top: 0 });
  }

  // Custom starts from the dates already on screen rather than blank.
  function pickRange(key: RangeKey) {
    if (key === "custom" && rangeKey !== "custom" && range) {
      setFrom(range.from);
      setTo(range.to);
    }
    setRangeKey(key);
  }

  // USD is always a valid entry currency (no conversion needed), whether
  // or not the org has ever bothered to add a redundant "1 USD = 1 USD"
  // row to fx_rates.
  const curOpts = Array.from(new Set([...data.fx.map((r) => r.currency), "USD"])).sort((a, b) => {
    const order = ["USD", "TZS", "ZMW", "CDF"];
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <PageBand
        kicker={VIEWS.find((v) => v.key === view)!.kicker}
        title={!oneTruck
          ? compared ? compareTitle(view as CompareView, compared) : VIEWS.find((v) => v.key === view)!.label
          : !truck ? "No trucks yet" : verdict ? verdict.text : `${truck.fleet_no} · ${truck.horse_reg}`}
        sub={!oneTruck ? periodLabel : truck && range ? [truck.horse_reg, periodLabel].filter(Boolean).join(" · ") : undefined}
        tabs={VIEWS.map((v) => ({ key: v.key, label: v.label }))}
        tab={view}
        onTab={(key) => setView(key as View)}
        label="Reports"
        actions={oneTruck && truck ? (
          <>
            {canEdit ? (
              <button type="button" className="act" aria-expanded={adding} onClick={() => setAdding(!adding)}>
                {adding ? "Close" : "+ Add truck cost"}
              </button>
            ) : null}
            {report ? (
              <>
                <button type="button" className={"chip" + (printLang === "en" ? " on" : "")} aria-pressed={printLang === "en"} onClick={() => setPrintLang("en")}>EN</button>
                <button type="button" className={"chip" + (printLang === "fr" ? " on" : "")} aria-pressed={printLang === "fr"} onClick={() => setPrintLang("fr")}>FR</button>
                <button type="button" className="ops-cta" onClick={() => setPrinting(true)}>Print / PDF</button>
              </>
            ) : null}
          </>
        ) : null}
        figs={!oneTruck ? (compared ? compareFigs(view as CompareView, compared) : undefined) : shown && range ? bandFigs(shown, range) : undefined}
      >
        <div className="band-filters">
          {oneTruck ? (
            <div className="band-field band-grow">
              <label htmlFor="rTruck">Truck</label>
              <select id="rTruck" value={truckId ?? ""} onChange={(e) => setTruckId(e.target.value)}>
                {data.trucks.map((t) => <option key={t.id} value={t.id}>{t.fleet_no} — {t.horse_reg}</option>)}
              </select>
            </div>
          ) : null}
          <div className="band-field band-wide">
            <span className="band-label" id="rPeriod">Period</span>
            <div className="band-chips" role="group" aria-labelledby="rPeriod">
              {RANGES.map((r) => (
                <button key={r.key} type="button" className={"chip" + (r.key === rangeKey ? " on" : "")} aria-pressed={r.key === rangeKey} onClick={() => pickRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {rangeKey === "custom" ? (
            <div className="band-dates">
              <div className="band-field">
                <label htmlFor="rFrom">From</label>
                <input id="rFrom" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="band-field">
                <label htmlFor="rTo">To</label>
                <input id="rTo" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          ) : null}
          {oneTruck ? (
            <label className="band-check" htmlFor="rLedgers">
              <input id="rLedgers" type="checkbox" checked={includeLedgers} onChange={(e) => setIncludeLedgers(e.target.checked)} />
              Include trip ledgers when printing
            </label>
          ) : null}
        </div>
      </PageBand>

      {!oneTruck ? (
        compareError ? <div className="note bad">{compareError}</div>
          : compared ? <div className="dash-grid"><CompareBody view={view as CompareView} c={compared} onTruck={openTruck} /></div>
            : <div className="panel"><Spinner /></div>
      ) : !truck ? (
        <div className="empty">Add a truck under Admin → Fleet to see its report.</div>
      ) : loadingReport || !range ? (
        <div className="panel"><Spinner /></div>
      ) : reportError ? (
        <div className="note bad">{reportError}</div>
      ) : report ? (
        <ReportBody
          report={report}
          range={range}
          canEdit={canEdit}
          adding={adding}
          onAdd={() => setAdding(true)}
          onClose={() => setAdding(false)}
          onChanged={() => loadReport(report.truck.id, range)}
          onAllTime={rangeKey === "all" ? null : () => setRangeKey("all")}
          todayIso={day}
          curOpts={curOpts}
          fx={data.fx}
        />
      ) : null}

      {printing && report && oneTruck ? <ReportPrintSheet report={report} lang={printLang} onDone={() => setPrinting(false)} /> : null}
    </>
  );
}

// The comparison period, unless nothing at all was recorded in it: four
// figures each saying "up from 0" tell the reader nothing.
function comparable(r: TruckReport) {
  const p = r.previous;
  return p && (p.trips > 0 || p.revenue > 0 || p.tripCosts > 0 || p.owningCosts > 0) ? p : null;
}

function bandFigs(r: TruckReport, range: ReportRange): BandFig[] {
  const prev = comparable(r);
  const vs = range.previous?.label;
  const fleet = r.fleet?.avg;
  const notes = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ") || undefined;
  const loss = r.margin <= -0.5;
  const paid = collectionFigures(r);
  return [
    kpi(
      "rev",
      "Revenue",
      m0(r.tripRevenue),
      prev ? pctDelta(r.tripRevenue, prev.revenue, true) : null,
      vs,
      notes(plural(r.trips.length, "trip"), fleet && `fleet average ${m0(fleet.revenue)}`),
    ),
    {
      ...kpi(
        "trip",
        "Trip costs",
        m0(r.tripExpenses),
        prev ? pctDelta(r.tripExpenses, prev.tripCosts, false) : null,
        vs,
        fleet ? `fleet average ${m0(fleet.tripCosts)}` : "fuel, border fees and the like",
      ),
      title: "What its trips cost: fuel, border fees, driver allowances and the like.",
    },
    {
      ...kpi(
        "own",
        "Owning costs",
        m0(r.standingExpenses),
        prev ? pctDelta(r.standingExpenses, prev.owningCosts, false) : null,
        vs,
        fleet ? `fleet average ${m0(fleet.owningCosts)}` : "insurance, tyres, repairs and the like",
      ),
      title: "What it costs to keep the truck, working or not: insurance, tyres, repairs, licences. Buying it isn't included.",
    },
    {
      ...kpi(
        "net",
        loss ? "Loss" : "Profit",
        m0(Math.abs(r.margin)),
        prev ? betterWorse(r.margin, prev.profit) : null,
        vs,
        notes(
          r.tripRevenue > 0 && !loss && `${Math.round((r.margin / r.tripRevenue) * 100)}% of revenue`,
          fleet && (fleet.profit >= 0 ? `fleet average ${m0(fleet.profit)}` : `fleet average: a loss of ${m0(-fleet.profit)}`),
        ),
      ),
      tone: loss ? "bad" : r.margin >= 0.5 ? "pos" : undefined,
    },
    {
      ...kpi(
        "paid",
        "Collected",
        m0(paid.collected),
        null,
        undefined,
        notes(paid.revenue > 0 && `${Math.round((paid.collected / paid.revenue) * 100)}% of revenue`, paid.overdue >= 0.5 && `${m0(paid.overdue)} overdue`),
      ),
      title: "What customers have paid against these trips' invoices so far.",
    },
  ];
}

function ReportBody({
  report, range, canEdit, adding, onAdd, onClose, onChanged, onAllTime, todayIso, curOpts, fx,
}: {
  report: TruckReport;
  range: ReportRange;
  canEdit: boolean;
  adding: boolean;
  onAdd: () => void;
  onClose: () => void;
  onChanged: () => void;
  // Null when the report already covers all time.
  onAllTime: (() => void) | null;
  // Today on the company's calendar.
  todayIso: string;
  curOpts: string[];
  fx: BootstrapPayload["fx"];
}) {
  const empty = isEmpty(report);
  const rows = tripRows(report);
  const costs = (
    <section className="panel">
      <div className="panel-head">
        <h2>Truck costs</h2>
        <span className="r-min">{report.standingCosts.length} {report.standingCosts.length === 1 ? "entry" : "entries"} in this period</span>
      </div>
      <ul className="list x-rows">
        {report.standingCosts.length ? report.standingCosts.map((c) => (
          <li key={c.id}>
            <div>
              <div className="r-no" style={{ color: "var(--stamp)" }}>
                {lab(c.category)}
                {CAPITAL_CATEGORIES.has(c.category) ? <span className="pill grey rep-tag">buying the truck</span> : null}
              </div>
              <div style={{ fontSize: 13, marginTop: 1 }}>{c.description || "—"}</div>
              <div className="r-mono">{c.incurred_on}</div>
            </div>
            <div className="r-right">
              <div className="r-amt">{m2(c.amount_usd)}</div>
              <div className="r-min">{c.currency !== "USD" ? m2(c.amount, c.currency) : " "}</div>
            </div>
            {canEdit ? (
              <button className="x" aria-label="Remove this cost" onClick={() => deleteTruckCost(c.id, onChanged)}>✕</button>
            ) : null}
          </li>
        )) : <li className="empty">No truck costs in this period.</li>}
      </ul>
    </section>
  );

  // Top to bottom: the period in words and what to check before relying on
  // it, its trend, then two columns that each stack on their own -- the
  // money and the truck's own costs on the left, the payback and the
  // per-trip, per-km and per-day figures on the right -- and every trip.
  return (
    <>
      <div className="dash-grid">
        {adding ? (
          <>
            <section className="panel">
              <div className="panel-head">
                <h2>Add a truck cost</h2>
                <button type="button" className="act sm" onClick={onClose}>Close</button>
              </div>
              <AddTruckCostForm truckId={report.truck.id} curOpts={curOpts} fx={fx} onSaved={onChanged} />
            </section>
            {costs}
          </>
        ) : null}

        <InShort
          report={report}
          previousLabel={comparable(report) ? range.previous?.label ?? null : null}
          onAllTime={empty ? onAllTime : null}
        />

        <ChecksPanel checks={dataChecks(report)} />

        {report.monthly.length ? (
          <MonthlyChart
            title="Month by month"
            rows={report.monthly.map((mo) => ({ ...mo, costs: mo.tripCosts + mo.owningCosts }))}
            costsLabel="Costs"
            net="profit"
            note="USD · the last 12 months, whatever period is picked"
          />
        ) : null}
      </div>

      <div className="rep-cols">
        <div className="rep-col">
          {empty ? null : <MoneyPanel report={report} />}
          {empty ? null : <PaidPanel report={report} />}
          {adding ? null : costs}
        </div>
        <div className="rep-col">
          <PaybackPanel breakeven={report.breakeven} canAdd={canEdit && !adding} onAdd={onAdd} />
          {empty ? null : <UnitsPanel report={report} units={unitFigures(report, todayIso)} />}
        </div>
      </div>

      <TripsPanel rows={rows} />
    </>
  );
}

// Has the money these trips earned come in? One bar from collected to not
// invoiced yet, the amounts beside it, and what to do about the rest.
function PaidPanel({ report }: { report: TruckReport }) {
  const c = collectionFigures(report);
  if (c.revenue <= 0) return null;
  const all = c.collected >= c.revenue - 0.5;
  const pct = Math.round((c.collected / c.revenue) * 100);
  const parts = [
    { key: "got", label: "Collected", value: c.collected },
    { key: "due", label: "Invoiced, not due yet", value: c.notDue },
    { key: "late", label: "Overdue", value: c.overdue },
    { key: "todo", label: "Not invoiced yet", value: c.notInvoiced },
  ];
  const answer = all ? "Yes, all of it." : c.collected < 0.5 ? "Not yet: nothing collected so far." : `${pct}% so far.`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Has it been paid?</h2>
        <span className="r-min">of {m0(c.revenue)} earned</span>
      </div>
      <div className="payback">
        <div className={"payback-answer" + (all ? " pos" : "")}>{answer}</div>
        <div className="paid-bar" role="img" aria-label={parts.map((p) => `${p.label} ${m0(p.value)}`).join(", ")}>
          {parts.map((p) => (p.value >= 0.5 ? <span key={p.key} className={"paid-seg " + p.key} style={{ flexGrow: p.value }} title={`${p.label}: ${m2(p.value)}`} /> : null))}
        </div>
        <ul className="split-key">
          {parts.filter((p) => p.value >= 0.5).map((p) => (
            <li key={p.key}>
              <i className={"paid-seg " + p.key} />
              <span>{p.label}</span>
              <b className={p.key === "late" ? "neg" : undefined}>{m0(p.value)}</b>
            </li>
          ))}
        </ul>
        {c.overdue >= 0.5 || c.notInvoicedDelivered >= 0.5 ? (
          <p className="d-hint" style={{ marginTop: 10 }}>
            {c.overdue >= 0.5 ? `${m0(c.overdue)} is past its due date. ` : ""}
            {c.notInvoicedDelivered >= 0.5 ? `${m0(c.notInvoicedDelivered)} is from trips already delivered and not invoiced yet. ` : ""}
            <Link href="/billing">Open Billing</Link> to chase or invoice it.
          </p>
        ) : null}
        <p className="d-hint" style={{ marginTop: 8 }}>
          Payments count against each trip&apos;s invoices; an invoice for several trips is shared by its lines.
        </p>
        {report.paymentRatesMissing.length ? (
          <div className="note warn" style={{ marginTop: 10, marginBottom: 0 }}>
            Invoices in {report.paymentRatesMissing.join(", ")} aren&apos;t counted: no exchange rate on file.
          </div>
        ) : null}
      </div>
    </section>
  );
}

// What to put right before relying on the figures: trips with no costs or
// no revenue, fuel without litres, routes with no distance, trips still on
// the road. Each names its trips, linked to where they can be seen or fixed.
function ChecksPanel({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  const shown = 8;
  const serious = checks.some((c) => c.tone === "warn");
  return (
    <section className="panel dash-wide">
      <div className="panel-head">
        <h2>{serious ? "Before you rely on these figures" : "Worth knowing"}</h2>
        <span className="r-min">open a trip to see or fix it</span>
      </div>
      <ul className="short-lines check-lines">
        {checks.map((c) => (
          <li key={c.key} className={c.tone}>
            <span className="short-dot" aria-hidden="true" />
            <div>
              <p>{c.text}</p>
              <div className="check-trips">
                {c.trips.slice(0, shown).map((t) => (
                  <Link key={t.trip_id} className="trip-chip" href={tripHref(t)}>{t.trip_no}</Link>
                ))}
                {c.trips.length > shown ? <span className="r-min">and {c.trips.length - shown} more</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Where a trip opens: an open trip in the Cost docket, where its costs
// can still be put right; a closed one on the Board, since the docket
// lists open trips only and would open a different trip instead.
const tripHref = (t: TruckReport["trips"][number]) =>
  t.status === "closed" ? `/board?${new URLSearchParams({ filter: "all", trip: t.trip_id })}` : `/docket?trip=${t.trip_id}`;

const kmLabel = (km: number) => `${Math.round(km).toLocaleString("en-US")} km`;
const signedM0 = (n: number) => (n <= -0.5 ? `−${m0(-n)}` : m0(Math.max(0, n)));
const signedM2 = (n: number) => (n <= -0.005 ? `−${m2(-n)}` : m2(Math.max(0, n)));

function UnitFig({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <div>
      <span className="k">{k}</span>
      <span className={"v" + (tone ? " " + tone : "")}>{v}</span>
    </div>
  );
}

// The period broken down: the average trip, each kilometre, each litre of
// fuel and each day.
function UnitsPanel({ report, units }: { report: TruckReport; units: Units }) {
  const { perTrip, perKm, fuel, days } = units;
  const sign = (n: number) => (n < -0.005 ? "neg" : n > 0.005 ? "pos" : undefined);
  // What each km left: after all costs when every trip's distance is
  // known, otherwise after trip costs only.
  const kmLeft = perKm ? perKm.profit ?? perKm.revenue - perKm.tripCosts : 0;
  const trips = perTrip?.trips ?? 0;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Per trip, per km, per day</h2></div>

      {perTrip ? (
        <div className="unit">
          <div className="unit-head">The average trip <span>{plural(perTrip.trips, "trip")}</span></div>
          <div className="unit-figs">
            <UnitFig k="Revenue" v={m0(perTrip.revenue)} />
            <UnitFig k="Trip costs" v={m0(perTrip.tripCosts)} />
            <UnitFig k="Left over" v={signedM0(perTrip.left)} tone={sign(perTrip.left)} />
          </div>
          <p className="d-hint">
            {report.standingExpenses > 0
              ? `With its share of owning costs taken off too, each trip ${perTrip.profit < 0 ? `lost ${m0(-perTrip.profit)}` : `left ${m0(perTrip.profit)}`}.`
              : "No owning costs in this period to share out."}
          </p>
        </div>
      ) : null}

      {perKm ? (
        <div className="unit">
          <div className="unit-head">Each kilometre <span>{kmLabel(perKm.km)}</span></div>
          <div className="unit-figs">
            <UnitFig k="Revenue" v={m2(perKm.revenue)} />
            <UnitFig k={perKm.allCosts === null ? "Trip costs" : "All costs"} v={m2(perKm.allCosts ?? perKm.tripCosts)} />
            <UnitFig k={perKm.profit === null ? "Left over" : "Profit"} v={signedM2(kmLeft)} tone={sign(kmLeft)} />
          </div>
          <p className="d-hint">
            Each trip&apos;s route counted one way{perKm.returnKm > 0 ? `, plus ${kmLabel(perKm.returnKm)} driven back empty where a trip logged its empty return` : ""}.
            {perKm.leftOut ? ` ${plural(perKm.leftOut, "trip")} left out: no distance set for ${perKm.leftOut === 1 ? "its route" : "their routes"}, so owning costs aren't spread per km.` : ""}
          </p>
        </div>
      ) : null}

      {fuel ? (
        <div className="unit">
          <div className="unit-head">Fuel <span>{plural(fuel.trips, "trip")}</span></div>
          <div className="unit-figs">
            <UnitFig k="km per litre" v={fuel.kmPerLitre.toFixed(2)} />
            <UnitFig k="Litres per 100 km" v={fuel.litresPer100.toFixed(1)} />
            <UnitFig k="Fuel per km" v={m2(fuel.costPerKm)} />
          </div>
          <p className="d-hint">
            From trips with litres logged for all their fuel.
            {fuel.leftOut ? ` ${plural(fuel.leftOut, "other trip")} left out: fuel logged without litres, or none logged.` : ""}
          </p>
        </div>
      ) : null}

      {days ? (
        <div className="unit">
          <div className="unit-head">
            Days <span>{days.total === 1 ? "1 day" : `${days.total.toLocaleString("en-US")} days`}</span>
          </div>
          <div className="payback-answer unit-answer">Had a load on {Math.round(days.share * 100)}% of days.</div>
          <div className="meter" role="img" aria-label={`On a trip ${days.onTrip} of ${days.total} days`}>
            {days.onTrip > 0 ? <span style={{ width: `${days.share * 100}%` }} /> : null}
          </div>
          <div className="meter-ends">
            <span>{plural(days.onTrip, "day")} on a trip</span>
            <span>{plural(days.total - days.onTrip, "day")} without a load</span>
          </div>
          <div className="unit-figs">
            <UnitFig k="Average trip" v={days.avgTripDays === null ? "—" : `${days.avgTripDays.toFixed(1)} days`} />
            <UnitFig k="Late trips" v={trips ? `${days.late} of ${trips}` : "—"} />
            <UnitFig k="Profit per day" v={signedM0(days.profitPerDay)} tone={sign(days.profitPerDay)} />
          </div>
          <p className="d-hint">
            {!report.from || days.from > report.from ? `Counted from ${dayLabel(days.from)}, the truck's first day. ` : ""}
            A day counts from loading to delivery. Driving back, waiting for a load and time in the workshop count as days without a load.
          </p>
        </div>
      ) : null}
    </section>
  );
}

const FLAG: Record<Flag, { label: string; tone: string }> = {
  loss: { label: "lost money", tone: "bad" },
  no_costs: { label: "no costs", tone: "warn" },
  no_revenue: { label: "no revenue", tone: "warn" },
  late: { label: "late", tone: "warn" },
  no_litres: { label: "fuel without litres", tone: "grey" },
  running: { label: "on the road", tone: "grey" },
};

// What a trip's customer has paid, and where the rest stands.
function PaidCell({ trip }: { trip: TruckReport["trips"][number] }) {
  const f = trip.facts;
  const state = payState(trip);
  const note: Record<typeof state, ReactNode> = {
    paid: <small className="pos">paid in full</small>,
    overdue: <small className="neg">{m0(f.overdue_usd)} overdue</small>,
    part_paid: <small>of {m0(f.invoiced_usd)} invoiced</small>,
    invoiced: <small>invoiced, not due</small>,
    part_invoiced: <small>{m0(f.invoiced_usd)} invoiced</small>,
    not_invoiced: <small>not invoiced</small>,
    none: null,
  };
  return (
    <span className="tt-num tt-paid">
      <span className="tt-k">Paid</span>
      {state === "none" ? "—" : m0(f.collected_usd)}
      {note[state]}
    </span>
  );
}

function daysLabel(x: TripRow) {
  if (x.days === null) return "—";
  const d = x.days === 0 ? "same day" : plural(x.days, "day");
  return x.running ? `${d} so far` : d;
}

// Every trip loaded in the period, each opening in the Cost docket (or on
// the Board, once closed): where it went and for whom, how long it took,
// and what it made.
function TripsPanel({ rows }: { rows: TripRow[] }) {
  const [sort, setSort] = useState<"new" | "low">("new");
  const sorted = sort === "new" ? rows : [...rows].sort((a, b) => Number(a.trip.margin_usd) - Number(b.trip.margin_usd));
  return (
    <section className="panel rep-trips">
      <div className="panel-head">
        <h2>Trips <span className="r-min">{rows.length} loaded in this period</span></h2>
        {rows.length > 1 ? (
          <div className="sort-chips" role="group" aria-label="Order">
            <button type="button" className={"chip" + (sort === "new" ? " on" : "")} aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
            <button type="button" className={"chip" + (sort === "low" ? " on" : "")} aria-pressed={sort === "low"} onClick={() => setSort("low")}>Least profit</button>
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="tt">
          <div className="tt-row tt-head" aria-hidden="true">
            <span>Trip</span>
            <span>Route and customer</span>
            <span>Took</span>
            <span className="tt-num">Revenue</span>
            <span className="tt-num">Costs</span>
            <span className="tt-num">Margin</span>
            <span className="tt-num">Paid</span>
          </div>
          {sorted.map((x) => {
            const t = x.trip;
            const margin = Number(t.margin_usd || 0);
            const pills = x.flags.filter((f) => f !== "late");
            return (
              <Link key={t.trip_id} href={tripHref(t)} className={"tt-row" + (x.flags.includes("loss") ? " loss" : "")}>
                <span className="tt-trip">
                  <b>{t.trip_no}</b>
                  <span className="r-mono">{t.actual_load_date ? dayLabel(t.actual_load_date) : "—"}</span>
                </span>
                <span className="tt-route">
                  <span>{t.route}</span>
                  <span className="r-sub">{[t.customer, x.km ? kmLabel(x.km) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="tt-days">
                  <span className="tt-k">Took</span>
                  {daysLabel(x)}
                  {x.flags.includes("late") && t.target_days ? <span className="pill warn">late · target {t.target_days}</span> : null}
                </span>
                <span className="tt-num"><span className="tt-k">Revenue</span>{m0(t.revenue_usd)}</span>
                <span className="tt-num"><span className="tt-k">Costs</span>{m0(t.cost_usd)}</span>
                <span className={"tt-num tt-margin" + (margin <= -0.5 ? " neg" : margin >= 0.5 ? " pos" : "")}>
                  <span className="tt-k">Margin</span>
                  {signedM0(margin)}
                  {x.marginPct !== null ? <small>{Math.round(x.marginPct) < 0 ? "−" : ""}{Math.abs(Math.round(x.marginPct))}%</small> : null}
                </span>
                <PaidCell trip={t} />
                {pills.length ? (
                  <span className="tt-flags">
                    {pills.map((f) => <span key={f} className={"pill " + FLAG[f].tone}>{FLAG[f].label}</span>)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : <div className="empty">No trips loaded in this period.</div>}
      {rows.length ? <div className="panel-body bar-note">Open a trip to see its costs: open trips go to the Cost docket, closed ones to the Board.</div> : null}
    </section>
  );
}

// The report in a few sentences, beside one bar showing where the money
// went.
function InShort({ report, previousLabel, onAllTime }: { report: TruckReport; previousLabel: string | null; onAllTime: (() => void) | null }) {
  const lines = plainWords(report, previousLabel);
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
          {onAllTime ? (
            <li className="info short-more">
              <span />
              <p>This truck may have history outside these dates. <button type="button" className="act sm" onClick={onAllTime}>See all time</button></p>
            </li>
          ) : null}
        </ul>
        <Split report={report} />
      </div>
    </section>
  );
}

// Whole percentages that add up to exactly 100 (largest remainders get
// the spare points), so the bar's key never reads 99 or 101.
function wholeShares(values: number[]) {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let spare = 100 - floors.reduce((s, v) => s + v, 0);
  const byRemainder = exact.map((v, i) => [v - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (spare <= 0) break;
    floors[i] += 1;
    spare -= 1;
  }
  return floors;
}

// One bar for the period. In a profit it's every dollar earned, split into
// what trips cost, what owning the truck cost, and what was kept. In a
// loss it's everything spent, with a mark where the revenue ran out and
// the spending past it faded.
function Split({ report: r }: { report: TruckReport }) {
  if (r.totalExpenses <= 0 && r.tripRevenue <= 0) return null;
  const kept = r.tripRevenue > 0 && r.margin >= 0;
  const parts = [
    { key: "trip", label: "Trip costs", value: r.tripExpenses },
    { key: "own", label: "Owning costs", value: r.standingExpenses },
    ...(kept ? [{ key: "kept", label: "Kept as profit", value: r.margin }] : []),
  ];
  const shares = wholeShares(parts.map((p) => p.value));
  const covered = !kept && r.tripRevenue > 0 ? (r.tripRevenue / r.totalExpenses) * 100 : null;
  const heading = kept ? "Where each dollar it earned went" : r.tripRevenue > 0 ? "What it spent, against what it earned" : "What it spent";
  const summary = parts.map((p, i) => `${p.label} ${shares[i]}%`).join(", ");
  return (
    <div className="split-box">
      <div className="dash-sub split-head">{heading}</div>
      <div className="split-wrap">
        <div className="split" role="img" aria-label={`${heading}: ${summary}${covered === null ? "" : `. Revenue covered ${Math.round(covered)}% of it`}`}>
          {parts.map((p, i) => p.value > 0 ? (
            <span key={p.key} className={"split-seg " + p.key} style={{ flexGrow: p.value }} title={`${p.label}: ${m2(p.value)} (${shares[i]}%)`} />
          ) : null)}
        </div>
        {covered !== null ? (
          <>
            <span className="split-over" style={{ left: `${Math.min(100, covered)}%` }} />
            <span className="split-mark" style={{ left: `${Math.min(100, covered)}%` }} title={`Revenue: ${m2(r.tripRevenue)}`} />
          </>
        ) : null}
      </div>
      <ul className="split-key">
        {parts.map((p, i) => (
          <li key={p.key}>
            <i className={"split-seg " + p.key} />
            <span>{p.label}</span>
            <b>{kept ? `${shares[i]}¢` : m0(p.value)}</b>
          </li>
        ))}
        {covered !== null ? (
          <>
            <li>
              <i className="split-mark-key" />
              <span>Revenue ran out here</span>
              <b>{m0(r.tripRevenue)}</b>
            </li>
            <li>
              <i className="split-seg trip faded" />
              <span>Spent beyond its revenue</span>
              <b>{m0(-r.margin)}</b>
            </li>
          </>
        ) : null}
      </ul>
      {kept ? <div className="d-hint split-note">Cents out of every dollar of revenue.</div> : null}
    </div>
  );
}

// The period's income statement, as a list anyone can read: revenue, each
// cost with a bar on one shared scale and its share, and what was left.
function MoneyPanel({ report: r }: { report: TruckReport }) {
  const base = r.tripRevenue > 0 ? r.tripRevenue : r.totalExpenses;
  const share = (n: number) => {
    if (base <= 0) return "—";
    const p = (n / base) * 100;
    return p > 0 && p < 0.5 ? "<1%" : `${Math.round(p)}%`;
  };
  const max = Math.max(0, ...r.tripExpensesByCategory.map((c) => c.amountUsd), ...r.standingExpensesByCategory.map((c) => c.amountUsd));
  const loss = r.margin <= -0.5;

  const line = (c: CategoryAmount, note?: ReactNode) => (
    <Fragment key={c.category}>
      <div className="pl-row">
        <span className="pl-k">{cap(lab(c.category))}</span>
        <span className="bar-track">{c.amountUsd > 0 && max > 0 ? <span className="bar" style={{ width: `${(c.amountUsd / max) * 100}%` }} /> : null}</span>
        <span className="pl-a">{m2(c.amountUsd)}</span>
        <span className="pl-s">{share(c.amountUsd)}</span>
      </div>
      {note ? <div className="pl-note">{note}</div> : null}
    </Fragment>
  );
  const total = (label: string, amount: number) => (
    <div className="pl-row pl-total">
      <span className="pl-k">{label}</span>
      <span />
      <span className="pl-a">{m2(amount)}</span>
      <span className="pl-s">{share(amount)}</span>
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Where the money went</h2>
        <span className="r-min">{r.tripRevenue > 0 ? "% of revenue" : "% of costs"}</span>
      </div>
      <div className="pl">
        <div className="pl-row pl-top">
          <span className="pl-k">Revenue</span>
          <span />
          <span className="pl-a">{m2(r.tripRevenue)}</span>
          <span className="pl-s">{r.tripRevenue > 0 ? "100%" : "—"}</span>
        </div>

        <div className="pl-group">Trip costs <span>what its trips cost to run</span></div>
        {r.tripExpensesByCategory.length ? r.tripExpensesByCategory.map((c) => line(c, c.liters ? (
          <>
            {num(c.liters)} L · average {m2(c.avgPricePerLiterUsd)} a litre
            {c.withoutLitersUsd ? ` · ${m2(c.withoutLitersUsd)} logged without litres, not in the average` : null}
          </>
        ) : null)) : <div className="pl-note">None in this period.</div>}
        {total("Total trip costs", r.tripExpenses)}
        {r.emptyReturnExpenses > 0 && r.tripExpenses > 0 ? (
          <div className="pl-note">
            of which driving back empty: {m2(r.emptyReturnExpenses)} ({Math.round((r.emptyReturnExpenses / r.tripExpenses) * 100)}% of trip costs)
          </div>
        ) : null}

        <div className="pl-group">Owning costs <span>what it costs to keep, working or not</span></div>
        {r.standingExpensesByCategory.length
          ? r.standingExpensesByCategory.map((c) => line(c, NON_CASH_CATEGORIES.has(c.category) ? "A book entry spreading the purchase price: no money left an account." : null))
          : <div className="pl-note">None in this period.</div>}
        {total("Total owning costs", r.standingExpenses)}

        <div className={"pl-row pl-net" + (loss ? " neg" : r.margin >= 0.5 ? " pos" : "")}>
          <span className="pl-k">{loss ? "Loss" : "Profit"}</span>
          <span />
          <span className="pl-a">{m2(Math.abs(r.margin))}</span>
          <span className="pl-s">{r.tripRevenue > 0 ? share(Math.abs(r.margin)) : "—"}</span>
        </div>
        {r.capitalExpenses > 0 ? (
          <div className="pl-note pl-foot">
            Not counted above: {m2(r.capitalExpenses)} spent buying the truck in this period. That&apos;s tracked under “Has this truck paid for itself?”.
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Payback: how much of what the truck cost to buy it has earned back.
function PaybackPanel({ breakeven: b, canAdd, onAdd }: { breakeven: Breakeven; canAdd: boolean; onAdd: () => void }) {
  const head = <div className="panel-head"><h2>Has this truck paid for itself?</h2></div>;

  if (b.status === "no_data") {
    return (
      <section className="panel">
        {head}
        <div className="payback">
          <div className="payback-answer">Nothing to go on yet.</div>
          <p className="d-hint">This truck has no purchase date, trips or costs. Set its purchase date under Admin → Fleet and log what it cost to buy.</p>
        </div>
      </section>
    );
  }

  if (b.status === "no_investment") {
    return (
      <section className="panel">
        {head}
        <div className="payback">
          <div className="payback-answer">Can&apos;t say yet.</div>
          <p className="d-hint">
            What this truck cost to buy hasn&apos;t been logged. Add its purchase, clearing and registration costs, and this will show how much of that it has earned back.
          </p>
          {canAdd ? <button type="button" className="act" style={{ marginTop: 12 }} onClick={onAdd}>+ Add truck cost</button> : null}
        </div>
        <PaybackMonths breakeven={b} />
      </section>
    );
  }

  const done = b.status === "reached" && b.recovered >= b.investment;
  // Short of the line it never reads 100%, however close.
  const pct = done ? 100 : Math.max(0, Math.min(99, Math.round((b.recovered / b.investment) * 100)));
  const way = `${pct}% of the way`;
  const answer = b.status === "reached"
    ? done ? `Yes, in ${monthLabel(b.reachedOn)}.` : `It did in ${monthLabel(b.reachedOn)}, but has slipped back since.`
    : b.status === "projected"
      ? `Not yet: ${way}, about ${plural(b.monthsToGo, "month")} to go.`
      : b.status === "not_on_track"
        ? `Not yet: ${way}, and not getting closer.`
        : `Not yet: ${way}.`;
  const basis = "avgMonthlyNet" in b ? `its last ${b.basisMonths === 1 ? "full month" : `${b.basisMonths} full months`}` : "";

  return (
    <section className="panel">
      {head}
      <div className="payback">
        <div className={"payback-answer" + (done ? " pos" : "")}>{answer}</div>
        <div className={"meter" + (done ? " done" : "")} role="img" aria-label={`${pct}% of its purchase cost earned back`}>
          {pct > 0 ? <span style={{ width: `${pct}%` }} /> : null}
        </div>
        <div className="meter-ends">
          <span>{m0(Math.max(0, b.recovered))} earned back</span>
          <span>of {m0(b.investment)} paid for it</span>
        </div>
        {b.recovered < 0 ? (
          <p className="d-hint" style={{ marginTop: 8 }}>
            Since it was bought it has cost {m0(-b.recovered)} more than it has earned, so it&apos;s further from paying for itself than on day one.
          </p>
        ) : null}

        <div className="payback-facts">
          <div className="d-kv"><span>Counted from</span><span>{dayLabel(b.startDate)}</span></div>
          <div className="d-kv"><span>Paid for it (purchase, clearing, registration)</span><span>{m2(b.investment)}</span></div>
          <div className="d-kv"><span>Earned back so far</span><span>{b.recovered < 0 ? `−${m2(-b.recovered)}` : m2(b.recovered)}</span></div>
          {done && b.recovered > b.investment ? (
            <div className="d-kv"><span>Earned beyond what it cost</span><span>{m2(b.recovered - b.investment)}</span></div>
          ) : null}
          {"avgMonthlyNet" in b ? (
            <div className="d-kv">
              <span>Average a month, over {basis}</span>
              <span>{b.avgMonthlyNet < 0 ? `−${m2(-b.avgMonthlyNet)}` : m2(b.avgMonthlyNet)}</span>
            </div>
          ) : null}
          {b.status === "projected" ? (
            <div className="d-kv"><span>Should pay for itself around</span><span>{monthLabel(b.projectedOn)}</span></div>
          ) : null}
        </div>

        <p className="d-hint" style={{ marginTop: 10 }}>
          {b.status === "projected"
            ? "That date is a straight line from its recent months, not a forecast. "
            : b.status === "not_on_track"
              ? `Over ${basis} it cost more than it earned, so there's no date to give. `
              : b.status === "too_early"
                ? "It needs one full month of history before a date can be estimated. "
                : ""}
          Earned back is revenue less trip and owning costs since it was bought. Depreciation is left out: it&apos;s the purchase price again, on paper.
        </p>
      </div>
      <PaybackMonths breakeven={b} />
    </section>
  );
}

function PaybackMonths({ breakeven: b }: { breakeven: Breakeven }) {
  if (!b.months.length) return null;
  const signed = (n: number) => (n < 0 ? `−${m2(-n)}` : m2(n));
  return (
    <details className="payback-months">
      <summary>Month by month since {b.startDate ? monthLabel(b.startDate.slice(0, 7)) : "purchase"}</summary>
      <ul className="list" style={{ maxHeight: 280 }}>
        {[...b.months].reverse().map((mo) => (
          <li key={mo.month}>
            <div>
              <div className="r-no">{monthLabel(mo.month)}</div>
              <div className="r-mono">revenue {m0(mo.revenue)} · trip costs {m0(mo.tripCosts)} · owning costs {m0(mo.operatingCosts)}</div>
            </div>
            <div className="r-right">
              <div className={"r-amt " + (mo.net >= 0 ? "pos" : "neg")}>{signed(mo.net)}</div>
              <div className="r-min">running total {signed(mo.cumulative)}</div>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

async function deleteTruckCost(id: string, onDone: () => void) {
  if (!confirm("Remove this cost entry?")) return;
  const res = await fetch(`/api/truck-costs/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Cost entry removed");
    onDone();
  }
}

function AddTruckCostForm({
  truckId,
  curOpts,
  fx,
  onSaved,
}: {
  truckId: string;
  curOpts: string[];
  fx: BootstrapPayload["fx"];
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(OWNING_CATS[0]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(curOpts[0] ?? "USD");
  const [incurredOn, setIncurredOn] = useState(today(useCompanyTimeZone()));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amtNum = parseFloat(amount);
  const fxRate = fx.find((r) => r.currency === currency);
  const rateToUsd = currency === "USD" ? 1 : fxRate?.rate_to_usd;
  // Depreciation is a book entry, not money leaving an account.
  const cashAccount = useCashAccountChoice("out", currency);
  const inCashbook = category !== "depreciation";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      return setError("Enter an amount greater than zero.");
    }
    if (rateToUsd === undefined) {
      return setError(`No exchange rate on file for ${currency}.`);
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/truck-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        truckId,
        category,
        amount: amtNum,
        currency,
        incurredOn,
        description: description.trim() || null,
        cashAccountId: inCashbook ? cashAccount.submitted : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success(`${m2(amtNum, currency)} logged`);
    setAmount("");
    setDescription("");
    onSaved();
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="tcCat">Category</label>
        <select id="tcCat" value={category} onChange={(e) => setCategory(e.target.value)}>
          <optgroup label="Owning the truck">
            {OWNING_CATS.map((c) => <option key={c} value={c}>{cap(lab(c))}</option>)}
          </optgroup>
          <optgroup label="Buying the truck">
            {BUYING_CATS.map((c) => <option key={c} value={c}>{cap(lab(c))}</option>)}
          </optgroup>
        </select>
        {CAPITAL_CATEGORIES.has(category) ? (
          <div className="d-hint" style={{ marginTop: 6 }}>Counts toward what the truck cost to buy (its payback), not as a cost of the period.</div>
        ) : !inCashbook ? (
          <div className="d-hint" style={{ marginTop: 6 }}>A book entry: it lowers the profit, but no money leaves an account.</div>
        ) : null}
      </div>
      <div className="row3">
        <div className="field">
          <label htmlFor="tcAmt">Amount</label>
          <input id="tcAmt" type="number" step="0.01" min="0" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tcCur">Currency</label>
          <select id="tcCur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {curOpts.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tcDate">Date</label>
          <input id="tcDate" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
        </div>
      </div>
      <div className={"stamp" + (Number.isFinite(amtNum) && amtNum > 0 ? " live" : "")}>
        <span className="native">{Number.isFinite(amtNum) && amtNum > 0 ? m2(amtNum, currency) : "—"}</span>
        <span className="arrow">→</span>
        <span className={"usd" + (Number.isFinite(amtNum) && amtNum > 0 ? "" : " idle")}>
          {Number.isFinite(amtNum) && amtNum > 0 && rateToUsd !== undefined ? m2(amtNum * rateToUsd) : "USD 0.00"}
        </span>
        <span className="rate">
          {currency === "USD"
            ? "Recorded directly in USD — no conversion needed."
            : fxRate
              ? <>Rate on file <b>1 {currency} = {Number(fxRate.rate_to_usd).toFixed(8)} USD</b> · dated {fxRate.effective_on}</>
              : `No rate on file for ${currency}.`}
        </span>
      </div>
      <div className="field">
        <label htmlFor="tcDesc">Description</label>
        <input id="tcDesc" type="text" placeholder="e.g. Annual comprehensive cover" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {inCashbook ? <CashAccountField id="tcAccount" direction="out" currency={currency} choice={cashAccount} /> : null}
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save cost"}</button>
    </form>
  );
}

function ReportPrintSheet({ report, lang, onDone }: { report: TruckReport; lang: PrintLang; onDone: () => void }) {
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
          <div className="big">{t(lang, "truck_report")}</div>
          {report.truck.fleet_no} · {report.truck.horse_reg}<br />
          {report.from || "start"} – {report.to || "present"}
        </div>
      </div>
      <table>
        <thead><tr><th>{t(lang, "trip")}</th><th>{t(lang, "route")}</th><th>{t(lang, "loaded")}</th><th className="num">{t(lang, "days")}</th><th className="num">{t(lang, "revenue")}</th><th className="num">{t(lang, "cost")}</th><th className="num">{t(lang, "margin")}</th></tr></thead>
        <tbody>
          {tripRows(report).map(({ trip: tr, days }) => (
            <tr key={tr.trip_id}>
              <td>{tr.trip_no}</td>
              <td>{tr.route}</td>
              <td>{tr.actual_load_date || "—"}</td>
              <td className="num">{days ?? "—"}</td>
              <td className="num">{m2(tr.revenue_usd)}</td>
              <td className="num">{m2(tr.cost_usd)}</td>
              <td className="num">{m2(tr.margin_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {[
        { key: "standing_cost" as const, rows: report.standingCosts.filter((c) => !CAPITAL_CATEGORIES.has(c.category)) },
        { key: "purchase_cost" as const, rows: report.standingCosts.filter((c) => CAPITAL_CATEGORIES.has(c.category)) },
      ].map((group) => group.rows.length ? (
        <table key={group.key} style={{ marginTop: 18 }}>
          <thead><tr><th>{t(lang, group.key)}</th><th>{t(lang, "date")}</th><th className="num">{t(lang, "amount")}</th></tr></thead>
          <tbody>
            {group.rows.map((c) => (
              <tr key={c.id}>
                <td>{catLabel(lang, c.category)}{c.description ? " — " + c.description : ""}</td>
                <td>{c.incurred_on}</td>
                <td className="num">{m2(c.amount_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null)}
      {report.capitalExpenses > 0 ? <p style={{ fontSize: 10.5, color: "#555", marginTop: 6 }}>{t(lang, "purchase_costs_note")}</p> : null}

      <h4 style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "#555", marginTop: 26 }}>
        {t(lang, "profit_and_loss")}
      </h4>
      <table style={{ marginTop: 8 }}>
        <tbody>
          <tr><td>{t(lang, "revenue")}</td><td className="num">{m2(report.tripRevenue)}</td></tr>
          {report.tripExpensesByCategory.map((c) => (
            <tr key={"t-" + c.category}>
              <td>{t(lang, "trip_prefix")}: {catLabel(lang, c.category)}{c.liters ? ` (${num(c.liters)} L · avg ${m2(c.avgPricePerLiterUsd)}/L${c.withoutLitersUsd ? ` · ${m2(c.withoutLitersUsd)} ${t(lang, "without_liters")}` : ""})` : ""}</td>
              <td className="num">− {m2(c.amountUsd)}</td>
            </tr>
          ))}
          {report.standingExpensesByCategory.map((c) => (
            <tr key={"s-" + c.category}><td>{t(lang, "standing_prefix")}: {catLabel(lang, c.category)}</td><td className="num">− {m2(c.amountUsd)}</td></tr>
          ))}
          {report.emptyReturnExpenses > 0 ? (
            <tr><td style={{ color: "#555" }}>{t(lang, "empty_return_total")}</td><td className="num" style={{ color: "#555" }}>{m2(report.emptyReturnExpenses)}</td></tr>
          ) : null}
        </tbody>
      </table>
      <div className="totals">
        <div><span>{t(lang, "total_expenses")}</span><span>− {m2(report.totalExpenses)}</span></div>
        <div className="due"><span>{t(lang, "net_profit_loss")}</span><span>{pl(report.margin)}</span></div>
      </div>
      {report.breakeven.status !== "no_data" ? (
        <>
          <h4 style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "#555", marginTop: 26 }}>
            {t(lang, "asset_breakeven")}
          </h4>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>{t(lang, "total_investment")}</td><td className="num">{m2(report.breakeven.investment)}</td></tr>
              <tr><td>{t(lang, "purchase_date")}</td><td className="num">{report.breakeven.startDate}</td></tr>
              <tr><td>{t(lang, "recovered_to_date")}</td><td className="num">{pl(report.breakeven.recovered)}</td></tr>
              <tr>
                <td>{t(lang, "status")}</td>
                <td className="num">
                  {report.breakeven.status === "reached"
                    ? `${t(lang, "broke_even")} ${monthLabel(report.breakeven.reachedOn)}`
                    : report.breakeven.status === "projected"
                      ? `${t(lang, "projected")} ${monthLabel(report.breakeven.projectedOn)}`
                      : report.breakeven.status === "no_investment"
                        ? t(lang, "no_purchase_cost")
                        : report.breakeven.status === "too_early"
                          ? t(lang, "too_early")
                          : t(lang, "not_on_track")}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
      {report.trips.map((tr) => tr.costs ? (
        <div key={tr.trip_id} style={{ pageBreakBefore: "always" }}>
          <TripLedgerBody trip={tr} costs={tr.costs} allocations={tr.allocations} lang={lang} />
        </div>
      ) : null)}
    </div>,
    document.body,
  );
}
