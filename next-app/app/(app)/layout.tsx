import { redirect } from "next/navigation";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CompanyTimeZoneProvider } from "@/lib/components/CompanyTimeZone";
import { CompanyProvider } from "@/lib/components/Company";
import { COMPANY_FIELDS, type CompanyDetails } from "@/lib/company";
import { Nav } from "@/lib/components/Nav";
import { OrganizationsPicker } from "@/lib/components/OrganizationsPicker";
import { signOut } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getAuthedOrgContext();

  if (!ctx.ok) {
    // A platform admin with no active org yet (first login, or a
    // stale/cleared cookie) gets the org picker instead of being bounced
    // to /login -- every other failure (not signed in, or genuinely not a
    // member of any org) still redirects exactly as before.
    if (ctx.status === 403 && ctx.isPlatformAdmin) {
      return (
        <div className="wrap">
          <header>
            <div className="brand"><h1>Select an organization</h1></div>
          </header>
          <OrganizationsPicker />
        </div>
      );
    }
    redirect("/login");
  }

  const orgTitle = ctx.orgName.replace(/ Limited$/, "");

  // The letterhead every printout carries. Should the columns be missing
  // (code deployed ahead of its migration), documents still print with the
  // company's name rather than the page failing.
  const { data: org } = await ctx.admin
    .from("organizations")
    .select(COMPANY_FIELDS.join(", "))
    .eq("id", ctx.orgId)
    .maybeSingle<Record<(typeof COMPANY_FIELDS)[number], string | null>>();
  const company: CompanyDetails = {
    name: org?.legal_name?.trim() || ctx.orgName,
    registration_no: org?.registration_no ?? null,
    tax_id: org?.tax_id ?? null,
    address: org?.address ?? null,
    contact_phone: org?.contact_phone ?? null,
    contact_email: org?.contact_email ?? null,
    bank_details: org?.bank_details ?? null,
  };

  // The sidebar is fixed to the left; .app-body leaves room for it (see
  // --sidebar-w in globals.css) and the page column stays centred in what's
  // left. Printing hides all of .app-body (print sheets are portalled into
  // <body> beside it), so nothing on screen reaches the paper.
  return (
    <div className="app-body">
      <div className="wrap">
        <CompanyTimeZoneProvider timeZone={ctx.timeZone}>
          <CompanyProvider company={company}>
            <Nav orgTitle={orgTitle} orgId={ctx.orgId} email={ctx.email} role={ctx.role} isPlatformAdmin={ctx.isPlatformAdmin} signOutAction={signOut} />
            {children}
          </CompanyProvider>
        </CompanyTimeZoneProvider>
      </div>
    </div>
  );
}
