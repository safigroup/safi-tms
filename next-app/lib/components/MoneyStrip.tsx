import { m2 } from "@/lib/format";
import type { BoardTrip } from "@/lib/types";

const RUNNING = new Set(["draft", "allocated", "loading", "in_transit", "at_border"]);

// Revenue, costs and margin for one trip, side by side -- "so far" while
// the trip is still running, since more costs are on their way.
export function MoneyStrip({ trip }: { trip: BoardTrip }) {
  const running = RUNNING.has(trip.status);
  const margin = Number(trip.margin_usd || 0);
  return (
    <div className="money-strip">
      <div>
        <span className="k">Revenue</span>
        <span className="v">{m2(trip.revenue_usd)}</span>
      </div>
      <div>
        <span className="k">{running ? "Costs so far" : "Costs"}</span>
        <span className="v">{m2(trip.cost_usd)}</span>
        <span className="n">{trip.cost_entries} cost{trip.cost_entries === 1 ? "" : "s"}</span>
      </div>
      <div>
        <span className="k">{running ? "Margin so far" : "Margin"}</span>
        <span className={"v " + (margin >= 0 ? "pos" : "neg")}>{m2(margin)}</span>
        <span className="n">{trip.margin_pct != null ? `${trip.margin_pct}%` : "—"}</span>
      </div>
    </div>
  );
}
