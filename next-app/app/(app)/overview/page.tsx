"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m0, m2 } from "@/lib/format";
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
