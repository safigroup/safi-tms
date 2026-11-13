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

export const today = () => new Date().toISOString().slice(0, 10);

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
