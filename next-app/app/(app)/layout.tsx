import { redirect } from "next/navigation";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
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

  return (
    <div className="wrap">
      <Nav orgTitle={orgTitle} orgId={ctx.orgId} email={ctx.email} role={ctx.role} isPlatformAdmin={ctx.isPlatformAdmin} signOutAction={signOut} />
      {children}
    </div>
  );
}
