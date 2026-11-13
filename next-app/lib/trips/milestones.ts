import type { TripEvent } from "@/lib/types";
import { borderCrossings, placeName, samePlace, statusRank, type BorderCrossing } from "./timeline";

// Correcting a trip's milestone times after the fact (the Board's Edit
// times). The same list is built in the browser, to show and check the
// form, and on the server, to check again before anything is saved.

export type TimesTrip = {
  status: string;
  borders: string[] | null;
  actual_load_date: string | null;
  actual_delivery_at: string | null;
  pod_received_at: string | null;
};

export type HistoryEvent = Pick<TripEvent, "id" | "event_type" | "location" | "occurred_at" | "from_status" | "to_status">;

export type Milestone = {
  key: string;
  // The heading it sits under ("Loading", a border, "Delivery"), its label
  // there ("Arrived"), and its name on its own ("Arrived at Tunduma") for
  // messages and the edit history.
  group: string;
  label: string;
  name: string;
  type: "date" | "datetime";
  // As recorded: YYYY-MM-DD for a date, an ISO time otherwise. Null when
  // it was never logged.
  value: string | null;
  // False: shown for context, changed some other way (see note).
  editable: boolean;
  // Only a planned load date may be in the future.
  mayBeFuture: boolean;
  // Where it's kept: a trips column, a history entry, or both.
  tripField: "actual_load_date" | "actual_delivery_at" | "pod_received_at" | null;
  eventId: string | null;
  // Never logged: the border history entry adding it creates.
  add: { kind: "arrival" | "cleared"; location: string } | null;
  note: string | null;
  // Times that must run in order. The load date is a date, checked apart.
  inChain: boolean;
};

export function tripMilestones(trip: TimesTrip, events: HistoryEvent[]): Milestone[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const statusEvent = (match: (e: HistoryEvent) => boolean) =>
    sorted.find((e) => e.event_type === "status_change" && match(e)) ?? null;
  const r = statusRank(trip.status);
  const started = r >= statusRank("loading");
  const departed = r >= statusRank("in_transit");
  const delivered = r >= statusRank("delivered");

  const base = { editable: true, mayBeFuture: false, tripField: null, eventId: null, add: null, note: null, inChain: true };
  const ms: Milestone[] = [];

  ms.push({
    ...base,
    key: "load",
    group: "Loading",
    label: "Load date",
    name: "Load date",
    type: "date",
    value: trip.actual_load_date,
    mayBeFuture: !started,
    tripField: "actual_load_date",
    note: started
      ? "Days running count from it, and the trip's money counts in its month."
      : "Planned. The trip hasn't started loading.",
    inChain: false,
  });

  const loading = statusEvent((e) => e.to_status === "loading");
  if (loading) {
    ms.push({ ...base, key: "loading", group: "Loading", label: "Loading started", name: "Loading started", type: "datetime", value: loading.occurred_at, eventId: loading.id });
  }
  const departure = statusEvent((e) => e.from_status === "loading" && e.to_status === "in_transit");
  if (departure) {
    ms.push({ ...base, key: "departed", group: "Loading", label: "Departed", name: "Departed", type: "datetime", value: departure.occurred_at, eventId: departure.id });
  }

  // Each border on the trip's path, matched to its crossing in order (as
  // on the route line), so a path through the same post twice reads as two.
  const crossings = borderCrossings(sorted);
  const used = new Set<BorderCrossing>();
  type Slot = { key: string; location: string; crossing: BorderCrossing | null; onPath: boolean };
  const slots: Slot[] = (trip.borders ?? []).map((b, i) => {
    const c = crossings.find((x) => !used.has(x) && samePlace(x.location, b)) ?? null;
    if (c) used.add(c);
    return { key: `border:${i}`, location: b, crossing: c, onPath: true };
  });
  // Crossings at a post no longer on the path (it was changed since) still
  // show, straight after the last crossing logged before them.
  crossings.filter((c) => !used.has(c)).forEach((c, j) => {
    const t = (c.arrivedAt ?? c.clearedAt)!;
    const earlier = slots.findLastIndex((s) => {
      const st = s.crossing && (s.crossing.arrivedAt ?? s.crossing.clearedAt);
      return !!st && st <= t;
    });
    slots.splice(earlier + 1, 0, { key: `extra:${j}`, location: c.location ?? "", crossing: c, onPath: false });
  });

  // Where the truck is waiting now, if it is. Borders after it can't have
  // been crossed yet.
  const here = trip.status === "at_border"
    ? slots
        .filter((s) => s.crossing?.arrivedAt && !s.crossing.clearedAt)
        .sort((a, b) => b.crossing!.arrivedAt!.localeCompare(a.crossing!.arrivedAt!))[0] ?? null
    : null;
  const hereAt = here ? slots.indexOf(here) : -1;

  slots.forEach((s, i) => {
    const c = s.crossing;
    // A crossing nobody logged can be added once the truck is on the road.
    const canAdd = departed && s.onPath && !(hereAt >= 0 && i > hereAt);
    if (!c && !canAdd) return;
    const place = placeName(s.location);
    for (const kind of ["arrival", "cleared"] as const) {
      const value = (kind === "arrival" ? c?.arrivedAt : c?.clearedAt) ?? null;
      const eventId = (kind === "arrival" ? c?.arrivalId : c?.clearedId) ?? null;
      const stillThere = s === here && kind === "cleared";
      ms.push({
        ...base,
        key: `${s.key}:${kind}`,
        group: place,
        label: kind === "arrival" ? "Arrived" : "Cleared",
        name: kind === "arrival" ? `Arrived at ${place}` : `Cleared ${place}`,
        type: "datetime",
        value,
        editable: value != null ? !!eventId : canAdd && !stillThere,
        eventId,
        add: value == null ? { kind, location: c?.location ?? s.location } : null,
        note: stillThere ? "Still at the border. Log the clearance from the trip when it clears." : null,
      });
    }
  });

  // Delivery. Delivered is kept on the trip (days running stop there) and in
  // its history. A trip whose POD came in before it was marked delivered
  // never got a delivery time, so one can be added.
  const delivery = statusEvent((e) => e.to_status === "delivered");
  const deliveredAt = trip.actual_delivery_at ?? delivery?.occurred_at ?? null;
  if (deliveredAt || delivered) {
    ms.push({ ...base, key: "delivered", group: "Delivery", label: "Delivered", name: "Delivered", type: "datetime", value: deliveredAt, tripField: "actual_delivery_at", eventId: delivery?.id ?? null });
  }
  // POD received is recorded with the document on the docket; only its
  // time is corrected here.
  const pod = statusEvent((e) => e.to_status === "pod_received");
  const podAt = trip.pod_received_at ?? pod?.occurred_at ?? null;
  if (podAt) {
    ms.push({ ...base, key: "pod", group: "Delivery", label: "POD received", name: "POD received", type: "datetime", value: podAt, tripField: "pod_received_at", eventId: pod?.id ?? null });
  }
  return ms;
}

// Changed or added values by key: YYYY-MM-DD for a date, ISO otherwise.
export type TimeEdits = Record<string, string>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Clocks on phones drift; a minute either way isn't "the future".
const FUTURE_SLACK_MS = 60_000;

export function validTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar day of a time in a time zone, as YYYY-MM-DD.
export function dayIn(timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso: string) => f.format(new Date(iso));
}

function whenIn(timeZone: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (iso: string) => f.format(new Date(iso));
}

const dateLabel = (day: string) =>
  new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

const validValue = (m: Milestone, v: string) =>
  m.type === "date" ? DATE.test(v) && !isNaN(Date.parse(v + "T00:00:00Z")) : !isNaN(Date.parse(v));

// What's wrong with a set of changes, by milestone key; empty when they
// can be saved. Only a change is held to the order: times already out of
// order (a POD logged before the last border, say) don't block fixing
// something else.
export function checkTimes(ms: Milestone[], edits: TimeEdits, now: number, timeZone: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const fail = (key: string, message: string) => {
    if (!errors[key]) errors[key] = message;
  };
  const byKey = new Map(ms.map((m) => [m.key, m]));
  const day = dayIn(timeZone);
  const when = whenIn(timeZone);
  const today = day(new Date(now).toISOString());

  for (const [key, v] of Object.entries(edits)) {
    const m = byKey.get(key);
    if (!m || !m.editable) {
      fail(key, "This can't be changed here.");
    } else if (!validValue(m, v)) {
      fail(key, m.type === "date" ? "Enter a valid date." : "Enter a valid date and time.");
    } else if (m.type === "datetime" && Date.parse(v) > now + FUTURE_SLACK_MS) {
      fail(key, "Can't be in the future.");
    } else if (m.type === "date" && !m.mayBeFuture && v > today) {
      fail(key, "Can't be in the future.");
    }
  }

  const val = (m: Milestone) => {
    const v = edits[m.key] ?? m.value;
    return v && validValue(m, v) ? v : null;
  };
  const edited = (m: Milestone) => m.key in edits;

  const chain = ms.filter((m) => m.inChain && val(m));
  for (let j = 1; j < chain.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = chain[i];
      const b = chain[j];
      if (!edited(a) && !edited(b)) continue;
      if (Date.parse(val(b)!) < Date.parse(val(a)!)) {
        if (edited(b)) fail(b.key, `Can't be before ${a.name} (${when(val(a)!)}).`);
        else fail(a.key, `Can't be after ${b.name} (${when(val(b)!)}).`);
      }
    }
  }

  // The truck can't leave, cross a border or deliver before the day it
  // loaded. (Loading itself may have started the day before.)
  const load = byKey.get("load");
  const loadDay = load ? val(load) : null;
  if (load && loadDay) {
    for (const m of chain) {
      if (m.key === "loading" || (!edited(load) && !edited(m))) continue;
      const d = day(val(m)!);
      if (d < loadDay) {
        if (edited(m)) fail(m.key, `Must be on or after the load date (${dateLabel(loadDay)}).`);
        else fail(load.key, `Must be on or before ${m.name} (${dateLabel(d)}).`);
      }
    }
  }

  // An arrival on its own would read as a truck still waiting there.
  for (const m of ms) {
    if (m.add?.kind !== "arrival" || !edited(m)) continue;
    const cleared = byKey.get(m.key.replace(/:arrival$/, ":cleared"));
    if (cleared?.editable && !val(cleared)) fail(m.key, "Add when it cleared too.");
  }
  return errors;
}

// Edit-history fields written by a time correction (and by Edit trip
// before these moved here).
const TIME_FIELDS = new Set(["Load date", "Loading started", "Departed", "Delivered", "POD received", "actual_load_date", "actual_delivery_at"]);
export const isTimeField = (field: string) => TIME_FIELDS.has(field) || /^(Arrived at|Cleared) /.test(field);
