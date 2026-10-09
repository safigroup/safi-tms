import { m2, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { t, catLabel, statusLabel, type PrintLang } from "@/lib/print/translations";
import type { BoardTrip, TripCost } from "@/lib/types";

// The inner content of a trip's printed ledger -- everything but the
// #sheet portal/afterprint wiring, which differs between its two callers:
// Docket prints exactly one of these on its own, while a truck report
// prints the summary report followed by one of these per trip (see
// ReportPrintSheet), each starting on its own page. `lang` only
// translates the fixed labels below -- trip.customer, trip.commodity,
// a cost's description, and every other piece of free text stay exactly
// as entered, in whatever language they were written.
export function TripLedgerBody({ trip, costs, lang }: { trip: BoardTrip; costs: TripCost[]; lang: PrintLang }) {
  const total = costs.reduce((s, c) => s + Number(c.amount_usd), 0);

  return (
    <>
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />TPIN {COMPANY.tpin}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">{t(lang, "trip_ledger")}</div>
          {trip.trip_no}<br />{t(lang, "printed")} {today()}
        </div>
      </div>
      <div className="parties">
        <div>
          <h4>{t(lang, "trip")}</h4>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{trip.customer}</div>
          <div style={{ fontSize: 12, color: "#333" }}>
            {trip.route}<br />
            {trip.fleet_no ? <>{t(lang, "truck")} {trip.fleet_no}{trip.horse_reg ? " · " + trip.horse_reg : ""}<br /></> : null}
            {trip.driver ? <>{t(lang, "driver")} {trip.driver}<br /></> : null}
            {trip.commodity ? <>{trip.commodity}{trip.tonnage ? " · " + trip.tonnage + " t" : ""}{trip.volume_cbm ? " · " + trip.volume_cbm + " m³" : ""}<br /></> : null}
            {trip.container_no ? <>{t(lang, "container")} {trip.container_no}<br /></> : null}
            {trip.agent_name ? <>{t(lang, "agent")} {trip.agent_name}</> : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <h4>{t(lang, "status")}</h4>
          <div style={{ fontSize: 13 }}>{statusLabel(lang, trip.status)}</div>
          <div style={{ fontSize: 12, color: "#333", marginTop: 8 }}>
            {trip.actual_load_date ? <>{t(lang, "loaded")} {trip.actual_load_date}<br /></> : null}
            {trip.actual_delivery_at ? <>{t(lang, "delivered")} {trip.actual_delivery_at.slice(0, 10)}</> : null}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t(lang, "date")}</th>
            <th>{t(lang, "category")}</th>
            <th>{t(lang, "description")}</th>
            <th>{t(lang, "currency")}</th>
            <th className="num">{t(lang, "amount")}</th>
            <th className="num">USD</th>
          </tr>
        </thead>
        <tbody>
          {costs.length ? costs.map((c) => (
            <tr key={c.id}>
              <td>{c.incurred_on}</td>
              <td>{catLabel(lang, c.category)}</td>
              <td>{c.description || "—"}{c.location ? " · " + c.location : ""}</td>
              <td>{c.currency}</td>
              <td className="num">{c.currency !== "USD" ? m2(c.amount, c.currency) : "—"}</td>
              <td className="num">{m2(c.amount_usd)}</td>
            </tr>
          )) : (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "#555" }}>{t(lang, "no_costs")}</td></tr>
          )}
        </tbody>
      </table>
      <div className="totals">
        <div><span>{t(lang, "revenue")}</span><span>{m2(trip.revenue_usd)}</span></div>
        <div><span>{t(lang, "total_costs")}</span><span>{m2(total)}</span></div>
        <div className="due"><span>{t(lang, "margin")}</span><span>{m2(Number(trip.revenue_usd) - total)}</span></div>
      </div>
    </>
  );
}
