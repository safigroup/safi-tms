// Truck costs that buy the truck (rather than run it). The truck report's
// breakeven treats them as the investment, and the Overview leaves them
// out of a truck's running costs so one purchase doesn't swamp a period.
export const CAPITAL_CATEGORIES = new Set(["purchase", "clearing", "registration"]);
