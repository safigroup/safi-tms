// Truck costs that buy the truck (rather than run it). The truck report's
// payback treats them as the investment; its profit and the Overview leave
// them out, so one purchase doesn't swamp a period.
export const CAPITAL_CATEGORIES = new Set(["purchase", "clearing", "registration"]);

// Book entries: a cost on paper with no money leaving an account. Counted
// in a truck's profit, but not in its payback (the purchase it spreads is
// already the investment there) or in the Cashbook.
export const NON_CASH_CATEGORIES = new Set(["depreciation"]);
