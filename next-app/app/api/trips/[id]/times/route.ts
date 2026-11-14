import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";
import { validTimeZone } from "@/lib/format";
import { checkTimes, dayIn, tripMilestones, type Milestone, type TimeEdits } from "@/lib/trips/milestones";

// Corrects a trip's milestone times (the Board's Edit times): the load
// date, loading started, departed, each border arrival/clearance, delivered
// and POD received, including border crossings that were never logged.
//
// Body: { timeZone, changes: [{ key, from, to }] } -- `from` is the value
// the form was showing, so a trip that moved on in the meantime isn't
// overwritten blind. Everything is checked against the trip as it is now
// (lib/trips/milestones.ts, the same checks the form runs) and saved in one
// transaction by correct_trip_times, with an edit-history row for each.
type Change = { key: string; from: string | null; to: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const changes: Change[] | null = Array.isArray(body?.changes) ? body.changes : null;
  if (
    !changes ||
    !changes.length ||
    !changes.every((c) => c && typeof c.key === "string" && typeof c.to === "string" && (c.from === null || typeof c.from === "string")) ||
    new Set(changes.map((c) => c.key)).size !== changes.length
  ) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }
  if (!validTimeZone(body.timeZone)) {
    return NextResponse.json({ error: "unknown time zone" }, { status: 400 });
  }
  const timeZone: string = body.timeZone;

  const { data: trip } = await ctx.admin
    .from("trip_board")
    .select("status, borders, actual_load_date, actual_delivery_at, pod_received_at")
    .eq("trip_id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
  const { data: events, error: eventsError } = await ctx.admin
    .from("trip_events")
    .select("id, event_type, location, occurred_at, from_status, to_status")
    .eq("trip_id", id)
    .eq("org_id", ctx.orgId);
  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 400 });
  }

  const ms = tripMilestones(trip, events ?? []);
  const byKey = new Map(ms.map((m) => [m.key, m]));
  const stale = changes.some((c) => {
    const m = byKey.get(c.key);
    return !m || !sameValue(m, m.value, c.from);
  });
  if (stale) {
    return NextResponse.json(
      { error: "This trip changed while you were editing. Close the editor, reopen it and try again." },
      { status: 409 },
    );
  }

  const edits: TimeEdits = {};
  for (const c of changes) {
    const m = byKey.get(c.key)!;
    // Store times one way, whatever the browser sent.
    edits[c.key] = m.type === "datetime" && !isNaN(Date.parse(c.to)) ? new Date(c.to).toISOString() : c.to;
  }
  const errors = checkTimes(ms, edits, Date.now(), timeZone);
  if (Object.keys(errors).length) {
    return NextResponse.json({ error: "Some times need fixing.", errors }, { status: 400 });
  }

  const tripChanges: Record<string, string> = {};
  const eventChanges: { id: string; at: string }[] = [];
  const additions: { kind: string; location: string; at: string }[] = [];
  const audit: { field: string; old: string | null; new: string }[] = [];
  for (const [key, to] of Object.entries(edits)) {
    const m = byKey.get(key)!;
    if (sameValue(m, m.value, to)) continue;
    if (m.tripField) tripChanges[m.tripField] = to;
    if (m.eventId) eventChanges.push({ id: m.eventId, at: to });
    else if (m.add) additions.push({ kind: m.add.kind, location: m.add.location, at: to });
    if (key === "pod") tripChanges.pod_received_on = dayIn(timeZone)(to);
    audit.push({ field: m.name, old: m.value, new: to });
  }
  if (!audit.length) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await ctx.admin.rpc("correct_trip_times", {
    p_trip: id,
    p_org: ctx.orgId,
    p_user: ctx.userId,
    p_changes: { trip: tripChanges, events: eventChanges, add: additions, audit },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, changed: audit.length });
}

function sameValue(m: Milestone, a: string | null, b: string | null) {
  if (a === null || b === null) return a === b;
  return m.type === "date" ? a === b : Date.parse(a) === Date.parse(b);
}
