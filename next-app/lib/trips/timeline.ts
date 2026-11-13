import { durationLabel } from "@/lib/format";
import type { BoardTrip, Route, TripEvent } from "@/lib/types";

// A trip's journey, read from its history (trip_events): where it is on
// its route, and what happened when. Pure functions, so the Board and
// anything else that shows a journey tell the same story.

const ORDER = ["draft", "allocated", "loading", "in_transit", "at_border", "delivered", "pod_received", "invoiced", "closed"];
const rank = (s: string | null) => {
  const i = ORDER.indexOf(s ?? "");
  // at_border and in_transit are the same stage of the journey: a truck
  // goes back and forth between them at every border.
  return s === "at_border" ? ORDER.indexOf("in_transit") : i;
};

// Border names are stored as written on the route ("Kasumbalesa/Whiskey"),
// and shown by their first name.
export const placeName = (location: string | null) => (location || "the border").split("/")[0].trim();
const samePlace = (a: string | null, b: string | null) =>
  a === b || placeName(a).toLowerCase() === placeName(b).toLowerCase();

export type BorderCrossing = { location: string | null; arrivedAt: string | null; clearedAt: string | null };

// Pairs each clearance with the arrival before it at the same border.
export function borderCrossings(events: Pick<TripEvent, "event_type" | "location" | "occurred_at">[]): BorderCrossing[] {
  const crossings: BorderCrossing[] = [];
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (e.event_type === "border_arrival") {
      crossings.push({ location: e.location, arrivedAt: e.occurred_at, clearedAt: null });
    } else if (e.event_type === "border_cleared") {
      const open = [...crossings].reverse().find((c) => !c.clearedAt && samePlace(c.location, e.location));
      if (open) open.clearedAt = e.occurred_at;
      else crossings.push({ location: e.location, arrivedAt: null, clearedAt: e.occurred_at });
    }
  }
  return crossings;
}

export type TimelineEntry = {
  at: string;
  title: string;
  detail: string | null;
  tone: "neutral" | "good" | "warn" | "bad";
  by: string | null;
  // Time since the entry before it, when it's an hour or more (steps
  // logged together would otherwise all read "under 1h later").
  sinceLast: string | null;
};

const SAME_MOMENT_MS = 5_000;

function statusTitle(from: string | null, to: string | null): { title: string; tone: TimelineEntry["tone"] } {
  if (from === "closed" && to === "invoiced") return { title: "Reopened", tone: "warn" };
  if (to === "cancelled") return { title: "Cancelled", tone: "bad" };
  if (rank(to) < rank(from)) return { title: `Moved back to ${(to ?? "").replace(/_/g, " ")}`, tone: "warn" };
  switch (to) {
    case "allocated": return { title: "Truck allocated", tone: "neutral" };
    case "loading": return { title: "Loading started", tone: "neutral" };
    case "in_transit": return { title: from === "loading" ? "Departed" : "Back on the road", tone: "neutral" };
    case "at_border": return { title: "Marked at a border", tone: "neutral" };
    case "delivered": return { title: "Delivered", tone: "good" };
    case "pod_received": return { title: "POD received", tone: "good" };
    case "invoiced": return { title: "Invoiced", tone: "neutral" };
    case "closed": return { title: "Closed", tone: "neutral" };
    default: return { title: `Status: ${(to ?? "").replace(/_/g, " ")}`, tone: "neutral" };
  }
}

// What happened to a trip, oldest first. A border arrival or clearance
// already says what the status change logged with it says, so that
// change isn't listed twice.
export function buildTimeline(createdAt: string | null, events: TripEvent[]): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const borderTimes = sorted
    .filter((e) => e.event_type.startsWith("border_"))
    .map((e) => new Date(e.occurred_at).getTime());
  const loggedWithBorder = (e: TripEvent) => {
    const t = new Date(e.occurred_at).getTime();
    const borderMove = e.to_status === "at_border" || (e.from_status === "at_border" && e.to_status === "in_transit");
    return borderMove && borderTimes.some((b) => Math.abs(b - t) < SAME_MOMENT_MS);
  };
  const crossings = borderCrossings(sorted);

  const raw: Omit<TimelineEntry, "sinceLast">[] = [];
  if (createdAt) raw.push({ at: createdAt, title: "Trip created", detail: null, tone: "neutral", by: null });
  for (const e of sorted) {
    if (e.event_type === "border_arrival") {
      raw.push({ at: e.occurred_at, title: `Arrived at ${placeName(e.location)}`, detail: null, tone: "neutral", by: e.recorded_by_email });
    } else if (e.event_type === "border_cleared") {
      const c = crossings.find((x) => x.clearedAt === e.occurred_at && samePlace(x.location, e.location));
      const waited = c?.arrivedAt ? durationLabel(new Date(e.occurred_at).getTime() - new Date(c.arrivedAt).getTime()) : null;
      raw.push({
        at: e.occurred_at,
        title: `Cleared ${placeName(e.location)}`,
        detail: waited ? `${waited} at the border` : "Arrival wasn't logged",
        tone: "neutral",
        by: e.recorded_by_email,
      });
    } else if (e.event_type === "status_change" && !loggedWithBorder(e)) {
      raw.push({ at: e.occurred_at, ...statusTitle(e.from_status, e.to_status), detail: null, by: e.recorded_by_email });
    }
  }

  return raw.map((r, i) => {
    const gap = i === 0 ? 0 : new Date(r.at).getTime() - new Date(raw[i - 1].at).getTime();
    // A clearance already says how long it took since the arrival.
    const saysItsOwnGap = r.detail?.endsWith("at the border") && raw[i - 1]?.title.startsWith("Arrived");
    return { ...r, sinceLast: gap >= 3_600_000 && !saysItsOwnGap ? durationLabel(gap) : null };
  });
}

export type Stop = {
  label: string;
  // A border as written on the route ("Rubavu / Goma"); null for the ends.
  location: string | null;
  kind: "origin" | "border" | "destination";
  // done: passed. here: the truck is at this stop now. next: where it's
  // heading. ahead: later on the route.
  state: "done" | "here" | "next" | "ahead";
  note: string | null;
};

const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// The trip's route as a line of stops, origin -> each border -> destination,
// marked with how far the truck has got.
export function routeProgress(trip: BoardTrip, route: Route | undefined, events: TripEvent[], now: number): Stop[] {
  const r = rank(trip.status);
  const departed = r >= rank("in_transit");
  const arrived = r >= rank("delivered");
  const crossings = borderCrossings(events);

  const stops: Stop[] = [];
  stops.push({
    label: route?.origin || "Loading point",
    location: null,
    kind: "origin",
    state: departed ? "done" : trip.status === "loading" ? "here" : "next",
    note: trip.status === "loading" ? "Loading" : departed && trip.actual_load_date ? `Loaded ${shortDate(trip.actual_load_date)}` : null,
  });

  // Each border on the trip's path, matched to its crossing in order, so a
  // route that passes the same post twice reads each pass separately.
  const used = new Set<BorderCrossing>();
  for (const b of trip.borders ?? []) {
    const c = crossings.find((x) => !used.has(x) && samePlace(x.location, b));
    if (c) used.add(c);
    let state: Stop["state"] = "ahead";
    let note: string | null = null;
    if (c?.clearedAt) {
      state = "done";
      note = c.arrivedAt ? `${durationLabel(new Date(c.clearedAt).getTime() - new Date(c.arrivedAt).getTime())} wait` : "Cleared";
    } else if (c?.arrivedAt && trip.status === "at_border") {
      state = "here";
      note = `Waiting ${durationLabel(now - new Date(c.arrivedAt).getTime())}`;
    } else if (arrived) {
      // Delivered without this crossing logged: it was passed all the same.
      state = "done";
    }
    stops.push({ label: placeName(b), location: b, kind: "border", state, note });
  }

  stops.push({
    label: route?.destination || "Destination",
    location: null,
    kind: "destination",
    state: arrived ? "done" : "ahead",
    note: arrived && trip.actual_delivery_at ? `Delivered ${shortDate(trip.actual_delivery_at)}` : null,
  });

  // A border before one the truck has reached was passed, even if nobody
  // logged it.
  const furthest = stops.findLastIndex((s) => s.state === "done" || s.state === "here");
  for (let i = 0; i < furthest; i++) {
    if (stops[i].state === "ahead") stops[i].state = "done";
  }

  // On the road: the first stop not yet passed is where it's heading.
  if (departed && !arrived && !stops.some((s) => s.state === "here")) {
    const nextStop = stops.find((s) => s.state === "ahead");
    if (nextStop) nextStop.state = "next";
  }
  return stops;
}
