import { m0 } from "@/lib/format";
import type { BandFig } from "@/lib/components/PageBand";

// Figures for a page's band that carry a comparison: the value, how it
// moved against another period, and a note under it. Shared by the
// Overview and the truck report so both read the same way.

// `join` is the word between the change and the period it's against
// ("▲ 12% vs Oct", "USD 300 better than Oct").
export type Delta = { text: string; tone: "good" | "bad" | "flat"; join?: string };

// Change against the comparison period, coloured by whether that direction
// is good news for this figure.
export function pctDelta(cur: number, prev: number, upIsGood: boolean): Delta {
  if (prev === 0) return cur === 0 ? { text: "no change", tone: "flat" } : { text: "up from 0", tone: upIsGood ? "good" : "bad" };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { text: "no change", tone: "flat" };
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`, tone: pct > 0 === upIsGood ? "good" : "bad" };
}

export function ptsDelta(cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return { text: "no change", tone: "flat" };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pts`, tone: d > 0 ? "good" : "bad" };
}

// For a figure that can be negative (a profit or a loss), where a
// percentage change misleads: the difference in money, in words.
export function betterWorse(cur: number, prev: number): Delta {
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return { text: "the same as", tone: "flat", join: "" };
  return { text: `${m0(Math.abs(d))} ${d > 0 ? "better" : "worse"}`, tone: d > 0 ? "good" : "bad", join: "than" };
}

// A figure for the band: the value, its change against the comparison
// period, and a note under it.
export function kpi(key: string, k: string, v: string, delta?: Delta | null, vs?: string, note?: string): BandFig {
  return {
    key,
    k,
    v,
    n: delta || note ? (
      <>
        {delta ? <span className="nl"><span className={"delta " + delta.tone}>{delta.text}</span> {delta.join ?? "vs"} {vs}</span> : null}
        {note ? <span className="nl">{note}</span> : null}
      </>
    ) : undefined,
  };
}
