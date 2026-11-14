// Ported verbatim from the original app's helpers (index.html) — pure
// functions, no Supabase dependency, so no behavior change going along
// with the framework move. `esc()` isn't ported: it existed to defend
// hand-built innerHTML strings against XSS, which JSX does automatically
// for any text content.

export const m2 = (n: number | string | null | undefined, c = "USD") =>
  c + " " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const m0 = (n: number | string | null | undefined, c = "USD") =>
  c + " " + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const num = (n: number | string | null | undefined) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export const lab = (s: string | null | undefined) => String(s || "").replace(/_/g, " ");

// The calendar date of a moment in a time zone, as YYYY-MM-DD. Calendar
// dates -- today, the day a trip was delivered -- are the company's: pass
// useCompanyTimeZone() in the browser, ctx.timeZone on the server. Never
// UTC, which is still "yesterday" for the first hours of an African day.
export function dayIn(timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (when: string | number | Date) => f.format(new Date(when));
}

// Today's date in a time zone, as YYYY-MM-DD.
export const today = (timeZone: string) => dayIn(timeZone)(Date.now());

// Whether a time zone name (e.g. "Africa/Lusaka") is one this runtime knows.
export function validTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// A length of time, read the way a dispatcher says it: "under 1h", "14h",
// "3d 4h", and past a week just "12d".
export function durationLabel(ms: number) {
  const hours = Math.max(0, ms / 3_600_000);
  if (hours < 1) return "under 1h";
  if (hours < 48) return `${Math.floor(hours)}h`;
  if (hours < 24 * 7) return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
  return `${Math.floor(hours / 24)}d`;
}

// How long ago something started, for waits at a border and the like.
export function waitLabel(sinceIso: string, now: number) {
  return durationLabel(now - new Date(sinceIso).getTime());
}
