// Shared by the landing page's demo request form, the public route that
// validates it, and the platform-admin list that displays it -- stored as
// codes so a request reads the same whichever language it was sent in.
export const DEMO_COUNTRIES = [
  { code: "TZ", en: "Tanzania", fr: "Tanzanie" },
  { code: "ZM", en: "Zambia", fr: "Zambie" },
  { code: "CD", en: "DR Congo", fr: "RD Congo" },
  { code: "RW", en: "Rwanda", fr: "Rwanda" },
  { code: "BI", en: "Burundi", fr: "Burundi" },
  { code: "MW", en: "Malawi", fr: "Malawi" },
  { code: "UG", en: "Uganda", fr: "Ouganda" },
  { code: "KE", en: "Kenya", fr: "Kenya" },
  { code: "MZ", en: "Mozambique", fr: "Mozambique" },
  { code: "ZW", en: "Zimbabwe", fr: "Zimbabwe" },
  { code: "OTHER", en: "Other", fr: "Autre" },
] as const;

export const DEMO_FLEET_SIZES = [
  { code: "1-5", en: "1–5 trucks", fr: "1 à 5 camions" },
  { code: "6-20", en: "6–20 trucks", fr: "6 à 20 camions" },
  { code: "21-50", en: "21–50 trucks", fr: "21 à 50 camions" },
  { code: "51+", en: "More than 50", fr: "Plus de 50" },
] as const;
