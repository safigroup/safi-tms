import type { BoardTrip, Route } from "@/lib/types";
import { placeName, samePlace } from "./timeline";

// How far along its route a trip is, from what the Board list already
// carries (status, borders, last border) -- no history needed, so every
// row can show it. The trip's own Route line (timeline.ts) is the exact
// version, read from the border events.

export type TrackStop = { label: string; kind: "origin" | "border" | "destination"; at: number };

export type Track = {
  stops: TrackStop[];
  // 0 at the loading point, 1 at the destination; null before loading
  at: number | null;
  // where the truck is standing, when it's standing at a stop
  hereIndex: number | null;
  waiting: boolean; // at a border now
  done: boolean; // delivered or later
};

const DONE = new Set(["delivered", "pod_received", "invoiced", "closed"]);

export function tripTrack(trip: BoardTrip, route: Route | undefined): Track {
  const borders = trip.borders ?? [];
  const names = [route?.origin ?? "Loading point", ...borders.map(placeName), route?.destination ?? "Destination"];
  const last = names.length - 1;
  const stops: TrackStop[] = names.map((label, i) => ({
    label: label.split(",")[0].trim(),
    kind: i === 0 ? "origin" : i === last ? "destination" : "border",
    at: last ? i / last : 0,
  }));
  const borderIndex = trip.last_border ? borders.findIndex((b) => samePlace(b, trip.last_border)) : -1;
  const stopAt = (i: number) => stops[i].at;

  switch (trip.status) {
    case "loading":
      return { stops, at: 0, hereIndex: 0, waiting: false, done: false };
    case "at_border": {
      const i = borderIndex >= 0 ? borderIndex + 1 : 1;
      return { stops, at: stopAt(Math.min(i, last)), hereIndex: Math.min(i, last), waiting: true, done: false };
    }
    case "in_transit": {
      // halfway to the next stop after the last border it crossed
      const from = borderIndex >= 0 ? borderIndex + 1 : 0;
      const to = Math.min(from + 1, last);
      return { stops, at: (stopAt(from) + stopAt(to)) / 2, hereIndex: null, waiting: false, done: false };
    }
    default:
      if (DONE.has(trip.status)) return { stops, at: 1, hereIndex: last, waiting: false, done: true };
      return { stops, at: null, hereIndex: null, waiting: false, done: false };
  }
}
