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
