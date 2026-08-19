import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

export default async function HomePage() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) return null; // layout already redirects; keeps TS narrowed

  return (
    <div className="panel">
      <div className="panel-body">
        <p>
          signed in as {ctx.email} · {ctx.orgName}
        </p>
        <p className="d-hint" style={{ marginTop: 8 }}>
          Board, Cost docket, Billing, and Admin views land in the next
          phases of the migration.
        </p>
      </div>
    </div>
  );
}
