import type { CSSProperties } from "react";
import type { BoardTrip, Route } from "@/lib/types";
import { tripTrack } from "@/lib/trips/track";

// The truck drawn on route lines (the Board's trip rows and Route section,
// the Docket's trip header). Takes its colour from the text around it.
export function TruckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 16" width="24" height="13" className={"truck-icon" + (className ? " " + className : "")} aria-hidden="true">
      <rect x="0.5" y="2" width="18" height="9.5" rx="1.5" />
      <path d="M19.5 4.5h5.2l3.8 4v3h-9z" />
      <circle cx="5.5" cy="13" r="2.2" />
      <circle cx="12" cy="13" r="2.2" />
      <circle cx="24" cy="13" r="2.2" />
    </svg>
  );
}

// A trip's route as one thin line: a dot per stop (a diamond for each
// border), filled as far as the truck has got, with the truck on it. A
// picture of what the row's text already says, so screen readers skip it.
export function RouteTrack({ trip, route }: { trip: BoardTrip; route: Route | undefined }) {
  const t = tripTrack(trip, route);
  const at = t.at ?? 0;
  return (
    <div
      className={"track" + (t.at === null ? " planned" : "") + (t.waiting ? " waiting" : "") + (t.done ? " done" : "") + (trip.over_target && !t.done ? " late" : "")}
      style={{ "--at": at } as CSSProperties}
      aria-hidden="true"
      title={t.stops.map((s) => s.label).join(" → ")}
    >
      <span className="track-rail" />
      <span className="track-fill" />
      {t.stops.map((s, i) => (
        <span
          key={i}
          className={
            "track-dot " + s.kind +
            (t.at !== null && s.at <= at + 1e-9 ? " passed" : "") +
            (t.hereIndex === i ? " here" : "")
          }
          style={{ "--x": s.at } as CSSProperties}
        />
      ))}
      {t.at !== null && !t.done ? (
        <span className="track-truck"><TruckIcon /></span>
      ) : null}
    </div>
  );
}
