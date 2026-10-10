import { lab as englishLabel } from "@/lib/format";

// Shared by every print sheet (invoice, trip ledger, truck report,
// estimate) -- translates only the fixed scaffolding those sheets
// control (titles, column headers, section labels, the closed set of
// category/status codes). Never translates free text an admin typed in
// -- a cost description, a customer's address, a payment-milestone
// label -- since auto-translating arbitrary text risks mistranslating a
// financial document; that stays exactly as entered, in whatever
// language it was written.
export type PrintLang = "en" | "fr";

const STRINGS: Record<string, { en: string; fr: string }> = {
  // document titles
  trip_ledger: { en: "Trip Ledger", fr: "Registre de voyage" },
  truck_report: { en: "Truck Report", fr: "Rapport du camion" },
  invoice: { en: "Invoice", fr: "Facture" },
  cost_estimate: { en: "Cost Estimate", fr: "Devis estimatif" },
  printed: { en: "Printed", fr: "Imprimé le" },
  issued: { en: "Issued", fr: "Émise le" },
  due: { en: "Due", fr: "Échéance" },

  // shared section labels
  trip: { en: "Trip", fr: "Voyage" },
  route: { en: "Route", fr: "Itinéraire" },
  customer: { en: "Customer", fr: "Client" },
  truck: { en: "Truck", fr: "Camion" },
  driver: { en: "Driver", fr: "Chauffeur" },
  container: { en: "Container", fr: "Conteneur" },
  agent: { en: "Agent", fr: "Agent" },
  status: { en: "Status", fr: "Statut" },
  stage: { en: "Stage", fr: "Étape" },
  loaded: { en: "Loaded", fr: "Chargé le" },
  delivered: { en: "Delivered", fr: "Livré le" },
  via: { en: "Via", fr: "Via" },

  // table headers
  date: { en: "Date", fr: "Date" },
  category: { en: "Category", fr: "Catégorie" },
  cost_category: { en: "Cost category", fr: "Catégorie de coût" },
  description: { en: "Description", fr: "Description" },
  currency: { en: "Currency", fr: "Devise" },
  amount: { en: "Amount", fr: "Montant" },
  qty: { en: "Qty", fr: "Qté" },
  rate: { en: "Rate", fr: "Taux" },
  basis: { en: "Basis", fr: "Base" },

  // totals / money labels
  revenue: { en: "Revenue", fr: "Recette" },
  cost: { en: "Cost", fr: "Coût" },
  total_costs: { en: "Total costs", fr: "Coûts totaux" },
  margin: { en: "Margin", fr: "Marge" },
  subtotal: { en: "Subtotal", fr: "Sous-total" },
  received_to_date: { en: "Received to date", fr: "Reçu à ce jour" },
  amount_due: { en: "Amount due", fr: "Montant dû" },
  estimated_total_cost: { en: "Estimated total cost", fr: "Coût total estimé" },
  estimated_revenue: { en: "Estimated revenue", fr: "Recette estimée" },
  estimated_margin: { en: "Estimated margin", fr: "Marge estimée" },

  // invoice-specific
  invoice_to: { en: "Invoice to", fr: "Facturé à" },
  payment_terms: { en: "Payment terms", fr: "Conditions de paiement" },
  remit_to: { en: "Remit to", fr: "Payable à" },

  // trip ledger
  no_costs: { en: "No costs recorded on this trip.", fr: "Aucun coût enregistré pour ce voyage." },
  empty_return_tag: { en: "Empty return", fr: "Retour à vide" },
  empty_return_total: { en: "Of which, empty return legs", fr: "Dont retours à vide" },

  // basis suffixes (estimate table)
  flat: { en: "flat", fr: "forfait" },
  per_tonne_suffix: { en: "/ tonne", fr: "/ tonne" },
  per_cbm_suffix: { en: "/ m³", fr: "/ m³" },
  per_km_suffix: { en: "/ km", fr: "/ km" },
  estimate_disclaimer: {
    en: "This is an estimate only, based on configured cost/rate templates — actual trip costs and revenue may differ.",
    fr: "Ceci est une estimation uniquement, fondée sur les modèles de coûts/tarifs configurés — les coûts et recettes réels du voyage peuvent différer.",
  },

  // truck report
  standing_cost: { en: "Standing cost", fr: "Charge fixe" },
  trip_prefix: { en: "Trip", fr: "Voyage" },
  standing_prefix: { en: "Standing", fr: "Charge fixe" },
  profit_and_loss: { en: "Profit & loss", fr: "Compte de résultat" },
  total_expenses: { en: "Total expenses", fr: "Dépenses totales" },
  net_profit_loss: { en: "Net profit / (loss)", fr: "Résultat net / (perte)" },
  asset_breakeven: { en: "Asset breakeven", fr: "Seuil de rentabilité" },
  total_investment: { en: "Total investment", fr: "Investissement total" },
  purchase_date: { en: "Purchase date", fr: "Date d'achat" },
  broke_even: { en: "Broke even", fr: "Seuil atteint" },
  projected: { en: "Projected", fr: "Projeté" },
  not_on_track: { en: "Not on track at current pace", fr: "Hors trajectoire au rythme actuel" },
};

export function t(lang: PrintLang, key: keyof typeof STRINGS): string {
  return STRINGS[key][lang];
}

// Fixed vocabulary (trip_costs/truck_costs categories, trip status) --
// unlike free text, these are a closed set of codes the app itself
// defines, so a translation table is safe. Anything not in the table
// (there shouldn't be, but codes can only grow) falls back to the same
// underscore-stripped label English gets.
const CATEGORY_FR: Record<string, string> = {
  fuel: "Carburant",
  driver_advance: "Avance chauffeur",
  driver_allowance: "Indemnité chauffeur",
  border_fees: "Frais de douane",
  customs_duty: "Droits de douane",
  clearing_agent: "Agent en douane",
  tolls: "Péages",
  weighbridge: "Pont-bascule",
  permits: "Permis",
  escort: "Escorte",
  demurrage: "Surestarie",
  detention: "Détention",
  repairs: "Réparations",
  tyres: "Pneus",
  police: "Police",
  other: "Autre",
  purchase: "Achat",
  clearing: "Dédouanement",
  registration: "Immatriculation",
  maintenance: "Entretien",
  insurance: "Assurance",
  licensing: "Licences",
  depreciation: "Amortissement",
};

const STATUS_FR: Record<string, string> = {
  draft: "Brouillon",
  allocated: "Attribué",
  loading: "Chargement",
  in_transit: "En transit",
  at_border: "À la frontière",
  delivered: "Livré",
  pod_received: "Preuve de livraison reçue",
  invoiced: "Facturé",
  closed: "Clôturé",
  cancelled: "Annulé",
};

// The three legacy invoice_type values from before named payment
// milestones existed -- anything else (a milestone's own admin-entered
// label, e.g. "On loading") is free text and stays exactly as entered.
const INVOICE_TYPE_FR: Record<string, string> = {
  loading: "Chargement",
  delivery: "Livraison",
  full: "Intégral",
};

export function catLabel(lang: PrintLang, code: string): string {
  if (lang === "en") return englishLabel(code);
  return CATEGORY_FR[code] ?? englishLabel(code);
}

export function statusLabel(lang: PrintLang, code: string): string {
  if (lang === "en") return englishLabel(code);
  return STATUS_FR[code] ?? englishLabel(code);
}

export function invoiceTypeLabel(lang: PrintLang, code: string): string {
  if (lang === "en") return englishLabel(code);
  return INVOICE_TYPE_FR[code] ?? englishLabel(code);
}
