import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { signOut } from "./actions";

// Docket/Billing/Admin land in later phases -- shown as disabled tabs so the
// eventual structure is visible without offering a link into nothing.
const VIEWS = [
  { href: "/board", label: "Board", enabled: true },
  { href: "/docket", label: "Cost docket", enabled: false },
  { href: "/billing", label: "Billing", enabled: false },
  { href: "/admin", label: "Admin", enabled: false },
];

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
      <nav>
        {VIEWS.map((v) =>
          v.enabled ? (
            <Link key={v.href} href={v.href}>
              <button type="button">{v.label}</button>
            </Link>
          ) : (
            <button key={v.href} type="button" disabled title="Coming in a later phase">
              {v.label}
            </button>
          ),
        )}
      </nav>
      <div id="warn" />
      {children}
    </div>
  );
}
