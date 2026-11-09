// Suggestions, not a fixed list: category is free text so finance can add
// their own without an admin screen -- the form offers these plus every
// category the organization has already used.
export const DEFAULT_CATEGORIES = {
  in: ["Customer payment", "Loan received", "Owner capital", "Asset sale", "Other income"],
  out: [
    "Salaries & wages",
    "Rent & utilities",
    "Office & admin",
    "Communication & internet",
    "Insurance",
    "Licences & permits",
    "Taxes",
    "Loan repayment",
    "Bank charges",
    "Professional fees",
    "Vehicle purchase",
    "Other expense",
  ],
} as const;

export const TRANSFER_CATEGORY = "Transfer";

export const ACCOUNT_KIND_LABEL = { bank: "Bank", mobile_money: "Mobile money", cash: "Cash" } as const;
