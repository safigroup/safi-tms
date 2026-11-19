import "server-only";
import { FX_FEED } from "./schedule";

// open.er-api.com is free, keyless, and covers every currency this app has
// ever used (USD/TZS/ZMW/CDF/RWF confirmed) -- no account to manage, no
// quota to watch. Rates are official mid-market ones, which can differ
// from border-town cash rates; a rate entered by hand is always an option.
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

export { FX_FEED };

// Today's rates as units of each currency per US dollar, or why they
// couldn't be had, in words the Exchange rates page can show as they are.
export async function fetchUnitsPerUsd(): Promise<{ rates: Record<string, number>; error: null } | { rates: null; error: string }> {
  try {
    const res = await fetch(FX_API_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { rates: null, error: `${FX_FEED} answered with an error (HTTP ${res.status})` };
    const json = await res.json();
    if (json?.result !== "success" || !json.rates) {
      return { rates: null, error: `${FX_FEED} answered with an error${json?.["error-type"] ? ` (${json["error-type"]})` : ""}` };
    }
    return { rates: json.rates, error: null };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { rates: null, error: timedOut ? `${FX_FEED} didn't answer in time` : `couldn't reach ${FX_FEED}` };
  }
}
