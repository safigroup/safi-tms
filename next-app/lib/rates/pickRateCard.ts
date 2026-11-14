// Which rate card prices a trip. Shared by the New trip form, the
// Estimator page and /api/agent/estimate so all three agree.
//
// A card applies when it is for this route, for this customer (or names
// no customer, meaning any), and is valid on the date: valid_from on or
// before it and valid_to blank or on or after it. Among those:
//   - a card for the trip's commodity beats one with no commodity, and a
//     card for a different commodity never applies;
//   - with no commodity given, a card with no commodity is the default; if
//     every card names a commodity, a lone one is used, but several are
//     ambiguous and the caller should ask which;
//   - a customer's own card beats an any-customer card, then the most
//     recent valid_from wins.

export type RateCardLike = {
  customer_id: string | null;
  route_id: string;
  commodity: string | null;
  valid_from: string;
  valid_to: string | null;
};

export type RatePick<T> = {
  card: T | null;
  // Commodities with their own rate for this customer and route on the
  // date, for hints ("rates on file for: Cement, Copper").
  commodities: string[];
  // Several commodity rates and none chosen -- ask which.
  ambiguous: boolean;
  // Cards exist for this customer and route, just none valid on the date.
  outOfDate: boolean;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function pickRateCard<T extends RateCardLike>(
  cards: T[],
  { customerId, routeId, commodity, onDate }: { customerId: string; routeId: string; commodity?: string | null; onDate: string },
): RatePick<T> {
  const pairing = cards.filter((c) => c.route_id === routeId && (c.customer_id === customerId || !c.customer_id));
  const valid = pairing.filter((c) => c.valid_from <= onDate && (!c.valid_to || c.valid_to >= onDate));
  const best = (list: T[]) =>
    [...list].sort((a, b) => Number(!a.customer_id) - Number(!b.customer_id) || b.valid_from.localeCompare(a.valid_from))[0] ?? null;

  const specific = valid.filter((c) => norm(c.commodity));
  const general = valid.filter((c) => !norm(c.commodity));
  const commodities = [...new Map(specific.map((c) => [norm(c.commodity), c.commodity!.trim()])).values()].sort();
  const result = (card: T | null, ambiguous = false): RatePick<T> => ({
    card,
    commodities,
    ambiguous,
    outOfDate: !valid.length && pairing.length > 0,
  });

  const want = norm(commodity);
  if (want) {
    const exact = specific.filter((c) => norm(c.commodity) === want);
    return result(best(exact.length ? exact : general));
  }
  if (general.length) return result(best(general));
  if (commodities.length === 1) return result(best(specific));
  return result(null, commodities.length > 1);
}
