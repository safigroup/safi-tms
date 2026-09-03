import "server-only";

// Server-only allowlist for /api/admin/[entity]. Deliberately separate
// from the client-side field config (app/(app)/admin/page.tsx's ENT_UI) --
// that one carries UI concerns (labels, hints, select options) that have
// no business being a security boundary. params.entity must be a key here
// or the route 404s; a request body's keys are filtered to exactly these
// columns, and org_id is always set server-side on insert, never from the
// body.
export const ADMIN_ENTITIES = {
  customers: {
    table: "customers",
    columns: ["name", "country", "tpin", "contact_name", "contact_phone", "contact_email", "payment_terms", "payment_days", "is_active"],
    hasToggle: true,
    permission: "commercial",
  },
  trucks: {
    table: "trucks",
    columns: ["fleet_no", "make_model", "horse_reg", "trailer_reg", "tank_capacity_l", "purchase_date", "is_active"],
    hasToggle: true,
    permission: "fleet",
  },
  drivers: {
    table: "drivers",
    columns: ["full_name", "phone", "nationality", "licence_no", "passport_no", "is_active"],
    hasToggle: true,
    permission: "fleet",
  },
  routes: {
    table: "routes",
    columns: ["name", "origin", "destination", "distance_km", "target_days", "borders"],
    hasToggle: false,
    permission: "fleet",
  },
  rate_cards: {
    table: "rate_cards",
    columns: ["customer_id", "route_id", "commodity", "rate_amount", "rate_currency", "rate_basis", "valid_from", "valid_to"],
    hasToggle: false,
    permission: "commercial",
  },
} as const;

export type AdminEntityKey = keyof typeof ADMIN_ENTITIES;

export function isAdminEntityKey(key: string): key is AdminEntityKey {
  return key in ADMIN_ENTITIES;
}
