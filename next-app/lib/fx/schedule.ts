import { dayLabel } from "@/lib/reports/periods";

// When exchange rates are replaced automatically, shared by the daily job
// (app/api/cron/fx-rates) and the Exchange rates page, so what the page
// says is what the job does.

// A currency's rate is replaced once its newest rate, automatic or
// entered by hand, is this many days old.
export const REFRESH_AFTER_DAYS = 14;

// The job runs at 06:00 UTC (vercel.json). On Vercel's Hobby plan it can
// land any time in that hour, so a rate due on a day should be in by 07:00
// UTC. Delivery is best effort -- a run can be skipped without a trace --
// which is why the page says when one is late rather than trusting it.
export const RUN_HOUR_UTC = 6;

// Where automatic rates come from (lib/fx/feed.ts fetches them).
export const FX_FEED = "open.er-api.com";

type Rate = { currency: string; effective_on: string };

export type FxCurrencyStatus = {
  currency: string;
  effectiveOn: string; // the rate in use: the newest one dated today or earlier
  age: number; // days old
  dueOn: string; // when the job should replace it
  late: boolean; // dueOn's run has been and gone
};

export type FxStatus = {
  state: "none" | "ok" | "due" | "late";
  currencies: FxCurrencyStatus[];
  late: FxCurrencyStatus[];
  oldest: FxCurrencyStatus | null;
  nextDue: string | null;
};

const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const addDays = (day: string, n: number) => new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

// How current each currency's rate is. US dollars are the base and never
// change, and a rate dated after today isn't in use yet.
export function fxStatus(rates: Rate[], todayIso: string, now = Date.now()): FxStatus {
  const inUse = new Map<string, string>();
  for (const r of rates) {
    const currency = r.currency.trim();
    if (currency === "USD" || r.effective_on > todayIso) continue;
    if (!inUse.has(currency) || r.effective_on > inUse.get(currency)!) inUse.set(currency, r.effective_on);
  }
  const currencies = [...inUse]
    .map(([currency, effectiveOn]) => {
      const dueOn = addDays(effectiveOn, REFRESH_AFTER_DAYS);
      return {
        currency,
        effectiveOn,
        age: daysBetween(effectiveOn, todayIso),
        dueOn,
        late: now >= utc(dueOn) + (RUN_HOUR_UTC + 1) * 3_600_000,
      };
    })
    .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || a.currency.localeCompare(b.currency));
  const late = currencies.filter((c) => c.late);
  const oldest = currencies[0] ?? null;
  return {
    state: !currencies.length ? "none" : late.length ? "late" : oldest!.dueOn <= todayIso ? "due" : "ok",
    currencies,
    late,
    oldest,
    nextDue: oldest?.dueOn ?? null,
  };
}

// "A", "A and B", "A, B and C".
export const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

// "today", "yesterday", "6 days ago".
export const agoLabel = (age: number) => (age <= 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`);

// The job's hour in the company's time zone: "09:00 and 10:00".
export function runWindow(timeZone: string, day: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = utc(day) + RUN_HOUR_UTC * 3_600_000;
  return `${f.format(start)} and ${f.format(start + 3_600_000)}`;
}

// "4 Nov", with the year only when it isn't this year's.
export const shortDay = (day: string, todayIso: string) => dayLabel(day, day.slice(0, 4) !== todayIso.slice(0, 4));
