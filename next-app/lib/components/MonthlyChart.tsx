"use client";

import { useState } from "react";
import { m0 } from "@/lib/format";
import { niceMax, short } from "@/lib/dashboard/trends";

export type MonthRow = { key: string; label: string; soFar: boolean; trips: number; revenue: number; costs: number };

// Revenue beside costs, month by month: paired bars on one scale, what was
// left over under each month, and the same figures as a table. The
// Overview shows the whole company's months, the truck report one truck's.
// `costsLabel` and `net` name the two things that differ between them:
// "Trip costs" leaving a "margin", or all "Costs" leaving a "profit".
export function MonthlyChart({
  title,
  rows,
  costsLabel = "Trip costs",
  net = "margin",
  note = "USD · by month loaded",
}: {
  title: string;
  rows: MonthRow[];
  costsLabel?: string;
  net?: string;
  note?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const Net = net.charAt(0).toUpperCase() + net.slice(1);
  const months = rows.map((r) => ({
    ...r,
    left: r.revenue - r.costs,
    leftPct: r.revenue > 0 ? ((r.revenue - r.costs) / r.revenue) * 100 : null,
  }));
  const max = niceMax(Math.max(0, ...months.flatMap((r) => [r.revenue, r.costs])));
  const ticks = [0, max / 2, max];
  const pct = (v: number) => `${(v / max) * 100}%`;
  const total = months.reduce((s, r) => ({ revenue: s.revenue + r.revenue, costs: s.costs + r.costs }), { revenue: 0, costs: 0 });
  const totalPct = total.revenue > 0 ? ((total.revenue - total.costs) / total.revenue) * 100 : null;
  return (
    <section className="panel dash-wide">
      <div className="panel-head mchart-head">
        <h2>{title}</h2>
        <div className="mchart-tools">
          {asTable ? null : (
            <span className="mchart-legend">
              <span><i className="mkey rev" /> Revenue</span>
              <span><i className="mkey cost" /> {costsLabel}</span>
            </span>
          )}
          <button type="button" className="act" onClick={() => setAsTable(!asTable)}>{asTable ? "Chart" : "Table"}</button>
        </div>
      </div>
      <div className="d-sec mchart-total">
        <span>{m0(total.revenue - total.costs)} {net} on {m0(total.revenue)} revenue{totalPct === null ? "" : ` · ${totalPct.toFixed(1)}%`}</span>
        <span className="r-mono">{note}</span>
      </div>
      {asTable ? (
        <div className="mtable-wrap">
          <table className="mtable">
            <thead><tr><th>Month</th><th>Trips</th><th>Revenue</th><th>{costsLabel}</th><th>{Net}</th><th>{Net} %</th></tr></thead>
            <tbody>
              {months.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}{r.soFar ? " (to date)" : ""}</td>
                  <td>{r.trips}</td>
                  <td>{m0(r.revenue)}</td>
                  <td>{m0(r.costs)}</td>
                  <td className={r.left < 0 ? "neg" : ""}>{m0(r.left)}</td>
                  <td className={r.left < 0 ? "neg" : ""}>{r.leftPct === null ? "—" : `${r.leftPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={"mchart" + (months.length > 8 ? " crowded" : "")}>
          <div className="mchart-y" aria-hidden="true">
            {ticks.map((t) => <span key={t} style={{ bottom: pct(t) }}>{short(t)}</span>)}
          </div>
          <div className="mchart-plot" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {ticks.map((t) => <span key={t} className="mgrid" style={{ bottom: pct(t) }} />)}
            {months.map((r) => {
              const label = `${r.label}${r.soFar ? " (to date)" : ""}: revenue ${m0(r.revenue)}, ${costsLabel.toLowerCase()} ${m0(r.costs)}, ${net} ${m0(r.left)}${r.leftPct === null ? "" : ` (${r.leftPct.toFixed(1)}%)`}, ${r.trips} trip${r.trips === 1 ? "" : "s"}`;
              return (
                <div key={r.key} className="mcol" title={label} aria-label={label} role="img">
                  {r.revenue > 0 ? <span className="mbar rev" style={{ height: pct(r.revenue) }} /> : <span className="mbar none" />}
                  {r.costs > 0 ? <span className="mbar cost" style={{ height: pct(r.costs) }} /> : <span className="mbar none" />}
                </div>
              );
            })}
          </div>
          <span />
          <div className="mchart-x" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((r) => (
              <div key={r.key}>
                <span className="mx-month">{r.label}{r.soFar ? <span className="mx-sofar"> so far</span> : null}</span>
                <span className={"mx-margin" + (r.left < 0 ? " neg" : "")}>{r.leftPct === null ? "—" : `${r.leftPct.toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
