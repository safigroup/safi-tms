// The truck report's period: quick ranges on the company's calendar, each
// with the period it's compared against. Pure functions over ISO dates
// (YYYY-MM-DD), so they can be checked on their own.

export type RangeKey = "month" | "last-month" | "quarter" | "year" | "all" | "custom";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

export type Span = { from: string; to: string; label: string };
// from/to are "" where the range is open at that end.
export type ReportRange = Span & { previous: Span | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const utc = (day: string) => Date.parse(day + "T00:00:00Z");
const addDays = (day: string, n: number) => new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
// m is 1-12, and may run past either end of the year.
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);

// "17 Nov 2026", or "17 Nov" without the year.
export function dayLabel(day: string, year = true) {
  const [y, m, d] = parts(day);
  return `${d} ${MONTHS[m - 1]}${year ? " " + y : ""}`;
}

// "1–17 Nov 2026", "1 Oct – 17 Nov 2026", "1 Oct 2025 – 17 Nov 2026". With
// year off, a range inside one year drops it ("1 Oct – 17 Nov").
export function spanLabel(from: string, to: string, year = true) {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fy !== ty) return `${dayLabel(from)} – ${dayLabel(to)}`;
  const tail = `${td} ${MONTHS[tm - 1]}${year ? " " + ty : ""}`;
  if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${tail}`;
  return fd === td ? tail : `${fd}–${tail}`;
}

// A comparison period's label: the year only when it isn't this year.
const compared = (from: string, to: string, todayIso: string) =>
  spanLabel(from, to, parts(to)[0] !== parts(todayIso)[0]);

// The dates a range covers and what it's compared with. Periods still
// running are compared like for like: this month's first 17 days against
// last month's first 17, not against all of last month.
export function resolveRange(key: RangeKey, todayIso: string, custom: { from: string; to: string }): ReportRange {
  const [y, m, d] = parts(todayIso);

  if (key === "month") {
    const prevFrom = monthStart(y, m - 1);
    const [py, pm] = parts(prevFrom);
    const prevTo = iso(py, pm, Math.min(d, lastDay(py, pm)));
    return {
      from: iso(y, m, 1),
      to: todayIso,
      label: spanLabel(iso(y, m, 1), todayIso),
      previous: { from: prevFrom, to: prevTo, label: compared(prevFrom, prevTo, todayIso) },
    };
  }

  if (key === "last-month") {
    const from = monthStart(y, m - 1);
    const [fy, fm] = parts(from);
    const to = iso(fy, fm, lastDay(fy, fm));
    const prevFrom = monthStart(y, m - 2);
    const [py, pm] = parts(prevFrom);
    const prevTo = iso(py, pm, lastDay(py, pm));
    return {
      from,
      to,
      label: `${MONTHS[fm - 1]} ${fy}`,
      previous: { from: prevFrom, to: prevTo, label: `${MONTHS[pm - 1]}${py !== y ? " " + py : ""}` },
    };
  }

  if (key === "quarter") {
    const first = m - ((m - 1) % 3);
    const from = iso(y, first, 1);
    const prevFrom = monthStart(y, first - 3);
    const prevEnd = addDays(from, -1);
    const sameDays = addDays(prevFrom, Math.round((utc(todayIso) - utc(from)) / DAY_MS));
    const prevTo = sameDays < prevEnd ? sameDays : prevEnd;
    return {
      from,
      to: todayIso,
      label: spanLabel(from, todayIso),
      previous: { from: prevFrom, to: prevTo, label: compared(prevFrom, prevTo, todayIso) },
    };
  }

  if (key === "year") {
    const from = iso(y, 1, 1);
    const prevFrom = iso(y - 1, 1, 1);
    const prevTo = iso(y - 1, m, Math.min(d, lastDay(y - 1, m)));
    return {
      from,
      to: todayIso,
      label: spanLabel(from, todayIso),
      previous: { from: prevFrom, to: prevTo, label: compared(prevFrom, prevTo, todayIso) },
    };
  }

  if (key === "custom" && (custom.from || custom.to)) {
    const { from, to } = custom;
    if (from && to && from <= to) {
      // The same number of days, ending the day before this range starts.
      const prevTo = addDays(from, -1);
      const prevFrom = addDays(prevTo, -Math.round((utc(to) - utc(from)) / DAY_MS));
      return { from, to, label: spanLabel(from, to), previous: { from: prevFrom, to: prevTo, label: compared(prevFrom, prevTo, todayIso) } };
    }
    const label = from && to ? "The end date is before the start date" : from ? `From ${dayLabel(from)}` : `Up to ${dayLabel(to)}`;
    return { from, to, label, previous: null };
  }

  return { from: "", to: "", label: "All time", previous: null };
}
