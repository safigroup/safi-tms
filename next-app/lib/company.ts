// The signed-in company's letterhead: printed at the top of invoices, truck
// reports, trip ledgers, cashbook statements and estimates, and its bank
// details under "Remit to" on invoices. Kept per organization
// (organizations.legal_name ... bank_details, edited in Admin -> Company);
// app/(app)/layout.tsx reads it once and hands it down with
// <CompanyProvider> (lib/components/Company.tsx).

export type CompanyDetails = {
  name: string; // legal_name, or the organization's name when that's empty
  registration_no: string | null;
  tax_id: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  bank_details: string | null;
};

// The organizations columns behind it.
export const COMPANY_FIELDS = ["legal_name", "registration_no", "tax_id", "address", "contact_phone", "contact_email", "bank_details"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

// The most each field may hold; the API refuses anything longer.
export const COMPANY_MAX: Record<CompanyField, number> = {
  legal_name: 120,
  registration_no: 120,
  tax_id: 120,
  address: 300,
  contact_phone: 60,
  contact_email: 120,
  bank_details: 600,
};

export const splitLines = (s: string | null | undefined) =>
  (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// The small print under the name, top to bottom; empty fields are left out.
export function letterheadLines(c: CompanyDetails): string[] {
  return [
    ...splitLines(c.registration_no),
    ...splitLines(c.tax_id),
    ...splitLines(c.address),
    [c.contact_phone, c.contact_email].map((s) => s?.trim()).filter(Boolean).join(" · "),
  ].filter(Boolean);
}
