"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import p from "./previews.module.css";

// Pictures of the real screens for the landing page, built from the app's
// own component classes (.panel, ul.list, .pill, .stamp, .strip,
// .stage-row, ol.route-line, .bar-row, .aging-row) so they can't drift far
// from what users actually see. All figures are illustrative.
//
// Deliberately English in both languages: the signed-in screens are
// English-only, so a French preview would promise an interface that
// doesn't exist. Hidden from screen readers -- the section copy beside
// each one says what it shows.

const usd = (n: number, dp = 0) =>
  "USD " + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

function Frame({ tab, children, className }: { tab: string; children: ReactNode; className?: string }) {
  return (
    <div className={`${p.frame} ${className ?? ""}`} aria-hidden="true">
      <div className={p.bar}>
        <span className={p.brand}>Safi TMS</span>
        <span className={p.tab}>{tab}</span>
      </div>
      <div className={p.body}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero: one trip, played forward. The truck moves border by border, each
// cost lands converted to dollars, and the margin so far follows it.

type StopState = "done" | "here" | "next" | "ahead";

const STOPS = [
  { label: "Dar es Salaam", kind: "town", at: 0 },
  { label: "Tunduma", kind: "border", at: 1 / 3 },
  { label: "Kasumbalesa", kind: "border", at: 2 / 3 },
  { label: "Lubumbashi", kind: "town", at: 1 },
] as const;

const COSTS = [
  { what: "Fuel", where: "Dar es Salaam", native: "TZS 2,950,000", usd: 1118.14 },
  { what: "Border fees", where: "Nakonde", native: "ZMW 4,850", usd: 182.36 },
  { what: "Fuel", where: "Kapiri Mposhi", native: "ZMW 22,400", usd: 842.24 },
  { what: "Clearing", where: "Kasumbalesa", native: "CDF 4,000,000", usd: 1400 },
];

const REVENUE = 9800;
// Costs logged before the first one shown: loading, permits, allowances.
const EARLIER = { usd: 2640, count: 7 };

const STEPS: { at: number; day: number; status: string; tone: "violet" | "warn" }[] = [
  { at: 0, day: 1, status: "loading", tone: "violet" },
  { at: 0.17, day: 2, status: "in transit", tone: "violet" },
  { at: 1 / 3, day: 3, status: "at border", tone: "warn" },
  { at: 0.5, day: 5, status: "in transit", tone: "violet" },
  { at: 2 / 3, day: 6, status: "at border", tone: "warn" },
];
const LAST = STEPS.length - 1;

function stopState(i: number, step: number): { state: StopState; note: string | null } {
  if (i === 0) return step === 0 ? { state: "here", note: "Loading" } : { state: "done", note: "Loaded 9 Nov" };
  if (i === 1) {
    if (step < 2) return { state: step === 1 ? "next" : "ahead", note: null };
    return step === 2 ? { state: "here", note: "Waiting 6h" } : { state: "done", note: "19h wait" };
  }
  if (i === 2) {
    if (step < 4) return { state: step === 3 ? "next" : "ahead", note: null };
    return { state: "here", note: "Waiting 31h" };
  }
  return { state: "ahead", note: null };
}

// Plays the steps once the element is in view; with reduced motion it
// shows the last step straight away.
function useSteps(last: number, everyMs: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = setTimeout(() => setStep(last), 0);
      return () => clearTimeout(timer);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        let s = 0;
        const tick = () => {
          s += 1;
          setStep(s);
          if (s < last) timer = setTimeout(tick, everyMs);
        };
        timer = setTimeout(tick, 700);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [last, everyMs]);
  return { ref, step };
}

function Truck() {
  return (
    <svg viewBox="0 0 30 16" width="30" height="16" className={p.truckIcon}>
      <rect x="0.5" y="2" width="18" height="9.5" rx="1.5" />
      <path d="M19.5 4.5h5.2l3.8 4v3h-9z" />
      <circle cx="5.5" cy="13" r="2.2" />
      <circle cx="12" cy="13" r="2.2" />
      <circle cx="24" cy="13" r="2.2" />
    </svg>
  );
}

export function LiveTrip({ caption }: { caption: string }) {
  const { ref, step } = useSteps(LAST, 1150);
  const s = STEPS[step];
  const shown = step; // costs[0..step-1] have landed
  const spent = EARLIER.usd + COSTS.slice(0, shown).reduce((t, c) => t + c.usd, 0);
  const margin = REVENUE - spent;

  return (
    <figure className={p.live} ref={ref}>
      <div className={p.stage}>
        <Frame tab="Board" className={p.liveFrame}>
          <div className={p.tripHead}>
            <div>
              <div className="r-no">T-1042</div>
              <div className={p.tripTitle}>Dar es Salaam → Lubumbashi</div>
              <div className="r-sub">ST-14 · Machine parts · 32 t</div>
            </div>
            <div className={p.tripRight}>
              <span key={s.status + step} className={`pill ${s.tone} ${p.pop}`}>{s.status}</span>
              <span className={p.day}>Day {s.day} of 14</span>
            </div>
          </div>

          <div className={p.track} style={{ "--at": s.at } as CSSProperties}>
            <span className={p.rail} />
            <span className={p.fill} />
            <span className={p.truck}><Truck /></span>
            {STOPS.map((st, i) => {
              const { state, note } = stopState(i, step);
              return (
                <span
                  key={st.label}
                  className={`${p.stop} ${p[state]} ${st.kind === "border" ? p.border : ""} ${i === 0 ? p.first : i === STOPS.length - 1 ? p.last : ""}`}
                  style={{ "--x": st.at } as CSSProperties}
                >
                  <span className={p.dot} />
                  <span className={p.stopName}>{st.label}</span>
                  <span className={p.stopNote}>{note ?? " "}</span>
                </span>
              );
            })}
          </div>

          <div className={p.feedHead}>
            <span>Costs logged</span>
            <span>{EARLIER.count + shown} costs</span>
          </div>
          <ul className={p.feed}>
            {COSTS.map((c, i) => (
              <li key={i} className={i < shown ? p.landed : p.waiting}>
                <span>
                  <span className={p.feedWhat}>{c.what} · {c.where}</span>
                  <span className={p.feedNative}>{c.native} →</span>
                </span>
                <span className={p.feedUsd}>{usd(c.usd, 2)}</span>
              </li>
            ))}
          </ul>

          <div className={p.sum}>
            <div>
              <span className={p.sumK}>Revenue</span>
              <span className={p.sumV}>{usd(REVENUE)}</span>
            </div>
            <div>
              <span className={p.sumK}>Costs so far</span>
              <span key={"c" + step} className={`${p.sumV} ${p.flash}`}>{usd(spent)}</span>
            </div>
            <div>
              <span className={p.sumK}>Margin so far</span>
              <span key={"m" + step} className={`${p.sumV} ${p.pos} ${p.flash}`}>
                {usd(margin)} <small>{((margin / REVENUE) * 100).toFixed(1)}%</small>
              </span>
            </div>
          </div>
        </Frame>

        <div className={`${p.toast} ${p.toastA} ${step >= 2 ? p.toastIn : ""}`} aria-hidden="true">
          <span className={p.toastK}>Billing · ready to invoice</span>
          <span className={p.toastT}>T-1042 · 40% at border</span>
          <span className={p.toastV}>{usd(3920)}</span>
        </div>
        <div className={`${p.toast} ${p.toastB} ${step >= 3 ? p.toastIn : ""}`} aria-hidden="true">
          <span className={p.toastK}>Overview · needs attention</span>
          <span className={p.toastT}>T-1039 · Late: day 5 of 4</span>
          <span className="pill bad">urgent</span>
        </div>
      </div>

      <figcaption className={p.caption}>{caption}</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Section previews

export function OverviewPreview() {
  return (
    <Frame tab="Overview">
      <div className={p.headRow}>
        <span className={p.h}>Overview</span>
        <span className="r-mono">This month so far · 1–15 Nov</span>
      </div>
      <div className={`strip ${p.kpis}`}>
        <div className="cell"><div className="k">Revenue</div><div className="v">USD 86,400</div><div className="n"><span className={p.up}>▲ 12%</span> on 1–15 Oct</div></div>
        <div className="cell"><div className="k">Margin</div><div className="v pos">28.3%</div><div className="n">USD 24,450</div></div>
        <div className="cell"><div className="k">Cash collected</div><div className="v">USD 54,200</div><div className="n">9 payments</div></div>
        <div className="cell"><div className="k">Overdue receivables</div><div className="v warn">USD 12,880</div><div className="n">3 invoices · oldest 41 days</div></div>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Trips by stage</span></div>
        <div className={`stage-row ${p.stages}`}>
          {[["Planned", 3], ["Loading", 1], ["In transit", 5], ["At border", 2], ["Awaiting POD", 1], ["To invoice", 2]].map(([k, n]) => (
            <span key={k} className="stage"><span className="stage-n">{n}</span><span className="stage-k">{k}</span></span>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Needs attention</span><span className="r-min">3 items</span></div>
        <ul className="list" style={{ maxHeight: "none" }}>
          <li>
            <div><div className="r-no">T-1039</div><div className={p.rowTitle}>Late: day 5 of 4</div><div className="r-sub">Kibo Traders · Dar es Salaam - Goma</div></div>
            <span className="pill bad">urgent</span>
          </li>
          <li>
            <div><div className="r-no">T-1042</div><div className={p.rowTitle}>Waiting at Kasumbalesa for 31h</div><div className="r-sub">Lualaba Supplies · Dar es Salaam - Lubumbashi</div></div>
            <span className="pill warn">check</span>
          </li>
          <li>
            <div><div className="r-no">T-1036</div><div className={p.rowTitle}>Delivered 4 days ago, no POD yet</div><div className="r-sub">Kibo Traders · Dar es Salaam - Kasumbalesa</div></div>
            <span className="pill warn">check</span>
          </li>
        </ul>
      </div>
    </Frame>
  );
}

function Field({ label, value, wide, hint, tone }: { label: string; value: ReactNode; wide?: boolean; hint?: ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className={`${p.field} ${wide ? p.wide : ""}`}>
      <span className={p.fieldK}>{label}</span>
      <span className={p.input}>{value}</span>
      {hint ? <span className={`${p.hint} ${tone === "good" ? p.good : tone === "warn" ? p.warn : ""}`}>{hint}</span> : null}
    </div>
  );
}

export function DispatchPreview() {
  return (
    <Frame tab="Board">
      <div className="panel">
        <div className="panel-head"><span className={p.h}>New trip</span><span className="r-min">Customer &amp; cargo</span></div>
        <div className={p.form}>
          <Field label="Customer" value="Lualaba Supplies SARL" />
          <Field label="Route" value="Dar es Salaam - Lubumbashi" />
          <Field label="Commodity" value="Machine parts" />
          <Field label="Tonnage (t)" value="32" />
          <Field
            wide
            label="Revenue (USD)"
            value="9,800.00"
            tone="good"
            hint="Filled from the rate card · Machine parts (USD 306.25 × 32 t)"
          />
        </div>
        <div className={p.formPart}>Truck &amp; schedule</div>
        <div className={p.form}>
          <div className={`${p.field} ${p.wide}`}>
            <span className={p.fieldK}>Truck</span>
            <ul className={p.menu}>
              <li className={p.menuOn}>ST-14 · T 482 DXY</li>
              <li>ST-03 · T 655 DKL</li>
              <li className={p.menuBusy}>ST-08 · T 913 DVB — on T-1039</li>
              <li className={p.menuBusy}>ST-11 · T 207 DRN — on T-1045</li>
            </ul>
          </div>
          <Field label="Driver" value="Juma Hassan" hint="This truck's usual driver." />
          <Field label="Planned load date" value="17 Nov 2026" />
        </div>
        <div className={p.actions}>
          <span className={p.btnPrimary}>Create trip</span>
          <span className={p.btnGhost}>Create and add another</span>
        </div>
      </div>
    </Frame>
  );
}

export function RoadPreview() {
  return (
    <Frame tab="Cost docket">
      <div className="panel">
        <div className="panel-head">
          <span className={p.h}>T-1042 · Dar es Salaam → Lubumbashi</span>
          <span className="pill warn">at border</span>
        </div>
        <div className={p.form}>
          <Field label="Category" value="Fuel" />
          <Field label="Amount" value={<>22,400 <b className={p.cur}>ZMW</b></>} />
          <Field label="Liters" value="800" hint="ZMW 28.00 a litre" />
          <Field label="Where" value="Kapiri Mposhi" />
          <div className={`${p.field} ${p.wide}`}>
            <span className={p.fieldK}>Receipt photo</span>
            <span className={p.receipt}>
              <span className={p.receiptThumb} />
              <span>receipt-kapiri.jpg</span>
              <span className={p.receiptOk}>attached</span>
            </span>
          </div>
        </div>
        <div className={p.stampWrap}>
          <div className="stamp live" style={{ margin: 0 }}>
            <span className="native">ZMW 22,400.00</span>
            <span className="arrow">→</span>
            <span className="usd">USD 842.24</span>
            <span className="rate">Rate on file <b>1 ZMW = 0.03760000 USD</b> · frozen onto this entry</span>
          </div>
        </div>
        <div className={p.budget}>
          <div className={p.budgetHead}>
            <span>Trip balance</span>
            <span>USD 217.26 left</span>
          </div>
          <span className={p.budgetTrack}><span className={p.budgetBar} style={{ width: "95.7%" }} /></span>
          <div className={p.budgetFoot}>
            <span>Allocated USD 5,000.00</span>
            <span>Spent USD 4,782.74</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function BorderPreview() {
  const stops: { label: string; kind: string; state: StopState; note: string | null }[] = [
    { label: "Dar es Salaam", kind: "origin", state: "done", note: "Loaded 9 Nov" },
    { label: "Tunduma", kind: "border", state: "done", note: "19h wait" },
    { label: "Kasumbalesa", kind: "border", state: "here", note: "Waiting 31h" },
    { label: "Lubumbashi", kind: "destination", state: "ahead", note: null },
  ];
  const borders = [
    { name: "Kasumbalesa", sub: "14 crossings · longest 4d 2h", hours: 54, label: "2d 6h", pill: "2 waiting, 31h" },
    { name: "Tunduma", sub: "22 crossings · longest 2d 1h", hours: 19, label: "19h" },
    { name: "Rusumo", sub: "9 crossings · longest 21h", hours: 8, label: "8h" },
  ];
  return (
    <Frame tab="Board">
      <div className="panel">
        <div className="d-sec">
          <h3 className="route-head">
            <span>Route · T-1042</span>
            <span className="route-day">Day 6 of 14</span>
          </h3>
          <ol className="route-line">
            {stops.map((s) => (
              <li key={s.label} className={`route-stop ${s.state} ${s.kind}`}>
                <span className="route-dot" />
                <span className="route-name">{s.label}</span>
                {s.note ? <span className="route-note">{s.note}</span> : null}
              </li>
            ))}
          </ol>
        </div>
        <div className={p.history}>
          <div className={p.historyRow}><span>Arrived at Kasumbalesa</span><span>14 Nov 08:10</span></div>
          <div className={p.historyRow}><span>Cleared Tunduma / Nakonde</span><span>11 Nov 16:40 · 19h wait</span></div>
          <div className={p.historyRow}><span>Loading started</span><span>9 Nov 07:30</span></div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Border waiting times</span><span className="r-min">arrival to clearance, average</span></div>
        <ul className="list" style={{ maxHeight: "none" }}>
          {borders.map((b) => (
            <li key={b.name} style={{ display: "block", padding: 0 }}>
              <div className="bar-row">
                <div className="bar-label">
                  <div className={p.rowTitle}>{b.name}{b.pill ? <span className="pill warn">{b.pill}</span> : null}</div>
                  <div className="r-sub">{b.sub}</div>
                </div>
                <span className="bar-track"><span className="bar" style={{ width: `${(b.hours / 54) * 100}%` }} /></span>
                <span className="bar-v">{b.label}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

export function BillingPreview() {
  const aging = [
    { k: "Not yet due", v: 31200 },
    { k: "1–30 days overdue", v: 9480 },
    { k: "31–60 days overdue", v: 3400 },
    { k: "60+ days overdue", v: 0 },
  ];
  return (
    <Frame tab="Overview">
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Ready to invoice</span><span className={p.link}>Open Billing</span></div>
        <div className="d-sec">
          <div className="dash-figure">USD 11,370</div>
          <div className="r-sub">3 milestones on 3 trips can be invoiced now</div>
        </div>
        <ul className="list" style={{ maxHeight: "none" }}>
          <li><div><div className="r-no">T-1042</div><div className={p.rowTitle}>Lualaba Supplies SARL</div><div className="r-sub">40% at border</div></div><div className="r-amt">USD 3,920</div></li>
          <li><div><div className="r-no">T-1040</div><div className={p.rowTitle}>Kibo Traders</div><div className="r-sub">50% on delivery</div></div><div className="r-amt">USD 4,800</div></li>
          <li><div><div className="r-no">T-1038</div><div className={p.rowTitle}>Great Lakes Agro</div><div className="r-sub">Balance on POD</div></div><div className="r-amt">USD 2,650</div></li>
        </ul>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Receivables</span><span className="r-min">USD 44,080 unpaid</span></div>
        <div className={p.aging}>
          {aging.map((a) => (
            <div key={a.k} className="aging-row">
              <span className="aging-k">{a.k}</span>
              <span className="aging-track">{a.v ? <span className="aging-bar" style={{ width: `${(a.v / 31200) * 100}%` }} /> : null}</span>
              <span className="aging-v">{usd(a.v)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Cashbook</span><span className="r-min">3 accounts</span></div>
        <ul className="list" style={{ maxHeight: "none" }}>
          <li><div><div className={p.rowTitle}>Bank · USD account</div><div className="r-sub">Bank</div></div><div className="r-amt">USD 48,210.55</div></li>
          <li><div><div className={p.rowTitle}>Mobile money · Dar es Salaam</div><div className="r-sub">Mobile money</div></div><div className="r-amt">TZS 6,480,000</div></li>
          <li><div><div className={p.rowTitle}>Cash box · Lubumbashi</div><div className="r-sub">Cash</div></div><div className="r-amt">CDF 2,150,000</div></li>
        </ul>
      </div>
    </Frame>
  );
}

export function ReviewPreview() {
  // Revenue and trip costs by month, thousands of USD.
  const months = [
    { m: "Jun", rev: 72, cost: 55 },
    { m: "Jul", rev: 81, cost: 60 },
    { m: "Aug", rev: 78, cost: 63 },
    { m: "Sep", rev: 90, cost: 64 },
    { m: "Oct", rev: 77, cost: 57 },
    { m: "Nov", rev: 86, cost: 62, soFar: true },
  ];
  const top = 100;
  const trucks = [
    { t: "ST-14 · T 482 DXY", sub: "4 trips · USD 8,240 trip margin · USD 1,420 running", v: 6820 },
    { t: "ST-08 · T 913 DVB", sub: "3 trips · USD 6,310 trip margin · USD 1,170 running", v: 5140 },
    { t: "ST-11 · T 207 DRN", sub: "3 trips · USD 4,985 trip margin · USD 1,080 running", v: 3905 },
    { t: "ST-03 · T 655 DKL", sub: "1 trip · USD 1,240 trip margin · USD 1,850 running", v: -610 },
  ];
  return (
    <Frame tab="Overview">
      <div className="panel">
        <div className="panel-head">
          <span className={p.h}>Revenue and costs by month</span>
          <span className={p.legend}>
            <span><i className={p.keyRev} />Revenue</span>
            <span><i className={p.keyCost} />Trip costs</span>
          </span>
        </div>
        <div className={p.chart}>
          {months.map((x) => (
            <div key={x.m} className={p.col}>
              <div className={p.bars}>
                <span className={p.rev} style={{ height: `${(x.rev / top) * 100}%` }} />
                <span className={p.cost} style={{ height: `${(x.cost / top) * 100}%` }} />
              </div>
              <span className={p.colM}>{x.m}{x.soFar ? "*" : ""}</span>
              <span className={p.colPct}>{Math.round(((x.rev - x.cost) / x.rev) * 100)}%</span>
            </div>
          ))}
        </div>
        <div className={p.chartNote}>Margin under each month · * so far</div>
      </div>
      <div className="panel">
        <div className="panel-head"><span className={p.h}>Profit per truck</span><span className="r-min">trip margin less running costs</span></div>
        <ul className="list" style={{ maxHeight: "none" }}>
          {trucks.map((r) => (
            <li key={r.t} style={{ display: "block", padding: 0 }}>
              <div className="bar-row">
                <div className="bar-label">
                  <div className={p.rowTitle}>{r.t}</div>
                  <div className="r-sub">{r.sub}</div>
                </div>
                <span className="bar-track"><span className={"bar" + (r.v < 0 ? " loss" : "")} style={{ width: `${(Math.abs(r.v) / 6820) * 100}%` }} /></span>
                <span className={"bar-v" + (r.v < 0 ? " neg" : "")}>{r.v < 0 ? "USD -" + Math.abs(r.v).toLocaleString("en-US") : usd(r.v)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
