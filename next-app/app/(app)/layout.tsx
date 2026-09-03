import { redirect } from "next/navigation";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { Nav } from "@/lib/components/Nav";
import { signOut } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getAuthedOrgContext();

  if (!ctx.ok) {
    redirect("/login");
  }

  const orgTitle = ctx.orgName.replace(/ Limited$/, "");

  return (
    <div className="wrap">
      <Nav orgTitle={orgTitle} email={ctx.email} role={ctx.role} signOutAction={signOut} />
      {children}
    </div>
  );
}
