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
      <header>
        <div className="brand">
          <h1>{orgTitle || "Safi TMS"}</h1>
        </div>
        <div className="who">
          {ctx.email} · {ctx.role} ·{" "}
          <form action={signOut} style={{ display: "inline" }}>
            <button type="submit">sign out</button>
          </form>
        </div>
      </header>
      <Nav />
      {children}
    </div>
  );
}
