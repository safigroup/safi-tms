import { m2, lab, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import type { BoardTrip, TripCost } from "@/lib/types";

// The inner content of a trip's printed ledger -- everything but the
// #sheet portal/afterprint wiring, which differs between its two callers:
// Docket prints exactly one of these on its own, while a truck report
// prints the summary report followed by one of these per trip (see
// ReportPrintSheet), each starting on its own page.
export function TripLedgerBody({ trip, costs }: { trip: BoardTrip; costs: TripCost[] }) {
  const total = costs.reduce((s, c) => s + Number(c.amount_usd), 0);

  return (
    <>
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />TPIN {COMPANY.tpin}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">Trip Ledger</div>
          {trip.trip_no}<br />Printed {today()}
        </div>
      </div>
      <div className="parties">
        <div>
          <h4>Trip</h4>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{trip.customer}</div>
          <div style={{ fontSize: 12, color: "#333" }}>
            {trip.route}<br />
            {trip.fleet_no ? <>Truck {trip.fleet_no}{trip.horse_reg ? " · " + trip.horse_reg : ""}<br /></> : null}
            {trip.driver ? <>Driver {trip.driver}<br /></> : null}
            {trip.commodity ? <>{trip.commodity}{trip.tonnage ? " · " + trip.tonnage + " t" : ""}{trip.volume_cbm ? " · " + trip.volume_cbm + " m³" : ""}<br /></> : null}
            {trip.container_no ? <>Container {trip.container_no}<br /></> : null}
            {trip.agent_name ? <>Agent {trip.agent_name}</> : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <h4>Status</h4>
          <div style={{ fontSize: 13 }}>{lab(trip.status)}</div>
          <div style={{ fontSize: 12, color: "#333", marginTop: 8 }}>
            {trip.actual_load_date ? <>Loaded {trip.actual_load_date}<br /></> : null}
            {trip.actual_delivery_at ? <>Delivered {trip.actual_delivery_at.slice(0, 10)}</> : null}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Description</th>
            <th>Currency</th>
            <th className="num">Amount</th>
            <th className="num">USD</th>
          </tr>
        </thead>
        <tbody>
          {costs.length ? costs.map((c) => (
            <tr key={c.id}>
              <td>{c.incurred_on}</td>
              <td>{lab(c.category)}</td>
              <td>{c.description || "—"}{c.location ? " · " + c.location : ""}</td>
              <td>{c.currency}</td>
              <td className="num">{c.currency !== "USD" ? m2(c.amount, c.currency) : "—"}</td>
              <td className="num">{m2(c.amount_usd)}</td>
            </tr>
          )) : (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "#555" }}>No costs recorded on this trip.</td></tr>
          )}
        </tbody>
      </table>
      <div className="totals">
        <div><span>Revenue</span><span>{m2(trip.revenue_usd)}</span></div>
        <div><span>Total costs</span><span>{m2(total)}</span></div>
        <div className="due"><span>Margin</span><span>{m2(Number(trip.revenue_usd) - total)}</span></div>
      </div>
    </>
  );
}
