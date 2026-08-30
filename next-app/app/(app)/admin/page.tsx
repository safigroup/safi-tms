"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { num, today } from "@/lib/format";
import { Spinner } from "@/lib/components/Spinner";
import type { BootstrapPayload, Customer, Route, FxRate, RouteBorderPath } from "@/lib/types";

type FieldType = "text" | "number" | "date" | "bool" | "select" | "fk" | "tags";

type FieldConfig = {
  k: string;
  label: string;
  type: FieldType;
  req?: boolean;
  half?: boolean;
  def?: string | number | boolean | (() => string);
  hint?: string;
  opts?: string[];
  from?: "customers" | "routes";
  lab?: string;
};

type RowView = { t: string; s?: string; m?: string; r?: string; off?: boolean; tag?: [string, string] };

// Mirrors lib/auth/permissions.ts -- UI convenience only (hides actions a
// role can't use), the route handlers are the real check.
const CAN_EDIT_FLEET = ["owner", "admin", "ops"];
const CAN_EDIT_COMMERCIAL = ["owner", "admin", "finance"];
const CAN_MANAGE_TEAM = ["owner", "admin"];

// Client-side UI config only -- labels, hints, field types, select options.
// Deliberately NOT the security boundary (that's lib/admin/entities.ts,
// server-only); this just drives what the form looks like. `permission`
// mirrors that file's field of the same name (fleet vs. commercial data).
const ENT_UI: Record<string, { label: string; permission: "fleet" | "commercial"; fields: FieldConfig[]; row: (r: Record<string, unknown>, data: BootstrapPayload) => RowView }> = {
  customers: {
    label: "Customers",
    permission: "commercial",
    fields: [
      { k: "name", label: "Name", type: "text", req: true },
      { k: "country", label: "Country", type: "select", opts: ["ZM", "TZ", "CD", "RW", "Other"] },
      { k: "tpin", label: "Tax ID / TPIN", type: "text" },
      { k: "contact_name", label: "Contact", type: "text", half: true },
      { k: "contact_phone", label: "Phone", type: "text", half: true },
      { k: "contact_email", label: "Email", type: "text" },
      { k: "payment_terms", label: "Payment terms", type: "text", def: "50% on loading, 50% on delivery. USD only.", hint: "Printed on their invoices." },
      { k: "payment_days", label: "Days to pay", type: "number", def: 0, hint: "0 means due on presentation." },
      { k: "is_active", label: "Active", type: "bool", def: true },
    ],
    row: (r) => ({
      t: String(r.name), s: [r.country, r.tpin].filter(Boolean).join(" · "),
      m: String(r.contact_email || r.contact_phone || ""), r: r.payment_days ? r.payment_days + "d" : "on presentation", off: !r.is_active,
    }),
  },
  trucks: {
    label: "Trucks",
    permission: "fleet",
    fields: [
      { k: "fleet_no", label: "Fleet number", type: "text", req: true, half: true },
      { k: "make_model", label: "Make / model", type: "text", def: "SHACMAN X3000", half: true },
      { k: "horse_reg", label: "Horse registration", type: "text", req: true, half: true },
      { k: "trailer_reg", label: "Trailer registration", type: "text", half: true },
      { k: "tank_capacity_l", label: "Tank capacity (litres)", type: "number" },
      { k: "is_active", label: "Active", type: "bool", def: true },
    ],
    row: (r) => ({
      t: String(r.fleet_no), s: String(r.make_model || ""), m: [r.horse_reg, r.trailer_reg].filter(Boolean).join(" / "),
      r: r.tank_capacity_l ? r.tank_capacity_l + " L" : "", off: !r.is_active,
    }),
  },
  drivers: {
    label: "Drivers",
    permission: "fleet",
    fields: [
      { k: "full_name", label: "Full name", type: "text", req: true },
      { k: "phone", label: "Phone", type: "text", half: true },
      { k: "nationality", label: "Nationality", type: "select", opts: ["TZ", "ZM", "CD", "RW", "Other"], half: true },
      { k: "licence_no", label: "Licence number", type: "text", half: true },
      { k: "passport_no", label: "Passport number", type: "text", half: true },
      { k: "is_active", label: "Active", type: "bool", def: true },
    ],
    row: (r) => ({
      t: String(r.full_name), s: String(r.phone || ""),
      m: [r.licence_no && "Lic " + r.licence_no, r.passport_no && "PP " + r.passport_no].filter(Boolean).join(" · "),
      r: String(r.nationality || ""), off: !r.is_active,
    }),
  },
  routes: {
    label: "Routes",
    permission: "fleet",
    fields: [
      { k: "name", label: "Route name", type: "text", req: true },
      { k: "origin", label: "Origin", type: "text", req: true, half: true },
      { k: "destination", label: "Destination", type: "text", req: true, half: true },
      { k: "distance_km", label: "Distance (km)", type: "number", half: true },
      { k: "target_days", label: "Target days", type: "number", half: true, hint: "Trips past this show as late." },
      { k: "borders", label: "Borders", type: "tags", hint: "Comma separated, in crossing order." },
    ],
    row: (r) => ({
      t: String(r.name), s: ((r.borders as string[]) || []).join(" → ") || "no borders listed", m: `${r.origin} → ${r.destination}`,
      r: [r.distance_km && r.distance_km + " km", r.target_days && r.target_days + "d"].filter(Boolean).join(" · "),
    }),
  },
  rate_cards: {
    label: "Rate cards",
    permission: "commercial",
    fields: [
      { k: "customer_id", label: "Customer", type: "fk", from: "customers", lab: "name", req: true },
      { k: "route_id", label: "Route", type: "fk", from: "routes", lab: "name", req: true },
      { k: "commodity", label: "Commodity", type: "text" },
      { k: "rate_amount", label: "Rate", type: "number", req: true, half: true },
      { k: "rate_currency", label: "Currency", type: "select", opts: ["USD"], def: "USD", half: true },
      { k: "rate_basis", label: "Basis", type: "select", opts: ["per_trip", "per_tonne"], def: "per_trip", half: true },
      { k: "valid_from", label: "Valid from", type: "date", def: today, half: true },
      { k: "valid_to", label: "Valid to", type: "date", hint: "Blank while it's current." },
    ],
    row: (r, data) => ({
      t: data.customers.find((c) => c.id === r.customer_id)?.name || "—",
      s: data.routes.find((x) => x.id === r.route_id)?.name || "—",
      m: [r.commodity, (r.rate_basis as string)?.replace("_", " ")].filter(Boolean).join(" · "),
      r: `${r.rate_currency} ${num(r.rate_amount as number)}`,
      tag: r.valid_to && (r.valid_to as string) < today() ? ["grey", "expired"] : ["good", "current"],
    }),
  },
};

const VIEWS = ["fx", "team", "customers", "trucks", "drivers", "routes", "rate_cards"] as const;
type ViewKey = (typeof VIEWS)[number];
const VIEW_LABELS: Record<ViewKey, string> = {
  fx: "Exchange rates", team: "Team", customers: "Customers", trucks: "Trucks", drivers: "Drivers", routes: "Routes", rate_cards: "Rate cards",
};

type TeamMember = { userId: string; email: string; role: string; createdAt: string };

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("fx");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/bootstrap");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setLoadError("Couldn't load — try refreshing.");
      return;
    }
    const payload: BootstrapPayload = await res.json();
    setData(payload);
    setLoadError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
  }

  async function loadTeam() {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setTeamError("Couldn't load the team list — try refreshing.");
      return;
    }
    const body = await res.json();
    setTeam(body.members);
    setViewerRole(body.viewerRole);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load/loadTeam are recreated every render, adding them here would refetch on every render too
  }, []);

  if (!data) return <div className="panel"><Spinner /></div>;

  const masters: Record<string, unknown[]> = {
    customers: data.customers, trucks: data.trucks, drivers: data.drivers, routes: data.routes, rate_cards: data.rateCards,
  };

  const canEditView = (v: ViewKey): boolean => {
    if (v === "team") return false;
    const permission = v === "fx" ? "commercial" : ENT_UI[v].permission;
    return (permission === "fleet" ? CAN_EDIT_FLEET : CAN_EDIT_COMMERCIAL).includes(data.role);
  };
  const canEdit = canEditView(view);

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
        {VIEWS.filter((v) => v !== "team" || CAN_MANAGE_TEAM.includes(data.role)).map((v) => (
          <button
            key={v}
            className={"chip" + (view === v ? " on" : "")}
            onClick={() => { setView(v); setSelected(null); setCreating(false); }}
          >
            {VIEW_LABELS[v]}<span className="c">{v === "fx" ? data.fx.length : v === "team" ? team?.length ?? 0 : masters[v].length}</span>
          </button>
        ))}
      </div>
      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h2>{VIEW_LABELS[view]}</h2>
            {view !== "fx" && view !== "team" && canEdit ? <button className="act" onClick={() => { setSelected(null); setCreating(true); }}>+ New</button> : null}
            {view === "team" ? <button className="act" onClick={() => { setSelected(null); setCreating(true); }}>+ Invite</button> : null}
          </div>
          {view === "fx" ? (
            <FxList fx={data.fx} />
          ) : view === "team" ? (
            teamError ? (
              <div className="panel-body"><div className="note bad">{teamError}</div></div>
            ) : team ? (
              <TeamList members={team} selected={selected} onSelect={(id) => { setSelected(id); setCreating(false); }} />
            ) : (
              <Spinner />
            )
          ) : (
            <EntityList
              entity={view}
              rows={masters[view]}
              data={data}
              selected={selected}
              onSelect={(id) => { setSelected(id); setCreating(false); }}
            />
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{view === "fx" ? "Add a rate" : view === "team" ? (creating ? "Invite" : "Team member") : selected ? "Edit" : creating ? "New" : "Detail"}</h2></div>
          <div className="panel-body">
            {view === "fx" ? (
              canEdit ? <FxForm onSaved={load} /> : <div className="empty">You have read-only access to exchange rates.</div>
            ) : view === "team" ? (
              creating ? (
                <InviteForm
                  viewerRole={viewerRole}
                  onInvited={async () => { await loadTeam(); }}
                  onCancel={() => setCreating(false)}
                />
              ) : team && selected ? (
                (() => {
                  const member = team.find((m) => m.userId === selected)!;
                  const isSelf = member.userId === data.userId;
                  const canReset =
                    isSelf ||
                    viewerRole === "owner" ||
                    (viewerRole === "admin" && member.role !== "owner" && member.role !== "admin");
                  return <TeamDetail key={selected} member={member} canReset={canReset} />;
                })()
              ) : (
                <div className="empty">Pick a team member.</div>
              )
            ) : creating || selected ? (
              <EntityForm
                key={view + ":" + (selected ?? "new")}
                entity={view}
                id={selected}
                data={data}
                onSaved={async () => { await load(); setSelected(null); setCreating(false); }}
                onCancel={() => { setSelected(null); setCreating(false); }}
                canEdit={canEdit}
              />
            ) : (
              <div className="empty">Pick a record, or add a new one.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const ROLE_PILL: Record<string, string> = { owner: "violet", admin: "violet", ops: "grey", finance: "grey", viewer: "grey" };

function TeamList({
  members,
  selected,
  onSelect,
}: {
  members: TeamMember[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="list">
      {members.length ? members.map((m) => (
        <li key={m.userId} className={"tap" + (selected === m.userId ? " sel" : "")} onClick={() => onSelect(m.userId)}>
          <div>
            <div className="r-title">{m.email}</div>
            <div className="r-mono">member since {m.createdAt.slice(0, 10)}</div>
            <div className="r-tags"><span className={"pill " + (ROLE_PILL[m.role] || "grey")}>{m.role}</span></div>
          </div>
        </li>
      )) : <li className="empty">No team members yet.</li>}
    </ul>
  );
}

const ALL_ROLES = ["owner", "admin", "ops", "finance", "viewer"];

function InviteForm({
  viewerRole,
  onInvited,
  onCancel,
}: {
  viewerRole: string | null;
  onInvited: () => Promise<void>;
  onCancel: () => void;
}) {
  const grantable = viewerRole === "owner" ? ALL_ROLES : ["ops", "finance", "viewer"];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(grantable[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError("Enter an email address.");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    const body = await res.json();
    toast.success("Invite created");
    setInviteUrl(body.inviteUrl);
    await onInvited();
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Copied");
  }

  if (inviteUrl) {
    return (
      <div className="d-sec" style={{ borderBottom: "none", paddingTop: 0 }}>
        <div className="note good">Invite created for {email} — share this link with them directly. It won&apos;t be shown again.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" readOnly value={inviteUrl} style={{ fontFamily: "var(--mono)" }} />
          <button className="act" type="button" onClick={copyLink}>Copy</button>
        </div>
        <button className="ghost" type="button" onClick={onCancel}>Done</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="iEmail">Email</label>
        <input id="iEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="iRole">Role</label>
        <select id="iRole" value={role} onChange={(e) => setRole(e.target.value)}>
          {grantable.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <button className="primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create invite"}</button>
      <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function TeamDetail({ member, canReset }: { member: TeamMember; canReset: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  async function confirmReset() {
    setResetting(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${member.userId}/reset-password`, { method: "POST" });
    setResetting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || res.statusText);
      return;
    }
    const body = await res.json();
    setConfirming(false);
    setPassword(body.password);
  }

  async function copyPassword() {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    toast.success("Copied");
  }

  return (
    <>
      <div className="d-sec" style={{ borderBottom: "none", paddingTop: 0 }}>
        <div className="d-kv"><span>Email</span><span>{member.email}</span></div>
        <div className="d-kv"><span>Role</span><span>{member.role}</span></div>
        <div className="d-kv"><span>Member since</span><span>{member.createdAt.slice(0, 10)}</span></div>
      </div>
      {canReset ? (
        <div className="d-sec">
          <h3>Reset password</h3>
          {error ? <div className="note bad">{error}</div> : null}
          {password ? (
            <>
              <div className="note good">New password generated — share it with {member.email} directly. It won&apos;t be shown again.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" readOnly value={password} style={{ fontFamily: "var(--mono)" }} />
                <button className="act" type="button" onClick={copyPassword}>Copy</button>
              </div>
            </>
          ) : confirming ? (
            <>
              <div className="d-hint" style={{ marginBottom: 10 }}>
                Reset password for {member.email}? The current password stops working immediately.
              </div>
              <div className="acts">
                <button className="act" style={{ borderColor: "var(--alert)", color: "var(--alert)" }} disabled={resetting} onClick={confirmReset}>
                  {resetting ? "Resetting…" : "Confirm reset"}
                </button>
                <button className="act" disabled={resetting} onClick={() => setConfirming(false)}>Never mind</button>
              </div>
            </>
          ) : (
            <button className="act" onClick={() => setConfirming(true)}>Reset password</button>
          )}
        </div>
      ) : null}
    </>
  );
}

function FxList({ fx }: { fx: FxRate[] }) {
  const latest: Record<string, FxRate> = {};
  fx.forEach((r) => { if (!latest[r.currency] || r.effective_on > latest[r.currency].effective_on) latest[r.currency] = r; });

  return (
    <ul className="list">
      {fx.length ? fx.map((r) => {
        const per = Number(r.rate_to_usd) > 0 ? 1 / Number(r.rate_to_usd) : 0;
        return (
          <li key={r.id}>
            <div>
              <div className="r-title">{r.currency}</div>
              <div className="r-mono">1 {r.currency} = {Number(r.rate_to_usd).toFixed(8)} USD</div>
              <div className="r-tags">
                {latest[r.currency]?.id === r.id ? <span className="pill good">in use</span> : <span className="pill grey">superseded</span>}
              </div>
            </div>
            <div className="r-right">
              <div className="r-amt" style={{ fontSize: 13 }}>{r.currency === "USD" ? "—" : num(per) + " / USD"}</div>
              <div className="r-min">{r.effective_on}</div>
            </div>
          </li>
        );
      }) : <li className="empty">No rates yet.</li>}
    </ul>
  );
}

function EntityList({
  entity,
  rows,
  data,
  selected,
  onSelect,
}: {
  entity: ViewKey;
  rows: unknown[];
  data: BootstrapPayload;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const ui = ENT_UI[entity];
  return (
    <ul className="list">
      {rows.length ? rows.map((raw) => {
        const r = raw as Record<string, unknown> & { id: string };
        const v = ui.row(r, data);
        return (
          <li key={r.id} className={"tap" + (selected === r.id ? " sel" : "") + (v.off ? " off" : "")} onClick={() => onSelect(r.id)}>
            <div>
              <div className="r-title">{v.t}</div>
              {v.s ? <div className="r-sub">{v.s}</div> : null}
              {v.m ? <div className="r-mono">{v.m}</div> : null}
              {v.off ? <div className="r-tags"><span className="pill grey">inactive</span></div>
                : v.tag ? <div className="r-tags"><span className={"pill " + v.tag[0]}>{v.tag[1]}</span></div> : null}
            </div>
            <div className="r-right"><div className="r-min">{v.r || ""}</div></div>
          </li>
        );
      }) : <li className="empty">No {ui.label.toLowerCase()} yet.</li>}
    </ul>
  );
}

function EntityForm({
  entity,
  id,
  data,
  onSaved,
  onCancel,
  canEdit,
}: {
  entity: ViewKey;
  id: string | null;
  data: BootstrapPayload;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  canEdit: boolean;
}) {
  const ui = ENT_UI[entity];
  const masters: Record<string, unknown[]> = {
    customers: data.customers, trucks: data.trucks, drivers: data.drivers, routes: data.routes, rate_cards: data.rateCards,
  };
  const existing = id ? (masters[entity].find((r) => (r as { id: string }).id === id) as Record<string, unknown> | undefined) : null;

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of ui.fields) {
      if (existing) v[f.k] = existing[f.k];
      else v[f.k] = typeof f.def === "function" ? f.def() : f.def ?? (f.type === "bool" ? false : "");
    }
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setField(k: string, v: unknown) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    for (const f of ui.fields) {
      if (f.req && (values[f.k] === null || values[f.k] === "" || values[f.k] === undefined)) {
        return setError(`${f.label} is required.`);
      }
    }
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const f of ui.fields) {
      payload[f.k] = f.type === "tags"
        ? String(values[f.k] || "").split(",").map((s) => s.trim()).filter(Boolean)
        : values[f.k];
    }
    const res = id
      ? await fetch(`/api/admin/${entity}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch(`/api/admin/${entity}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success("Saved");
    await onSaved();
  }

  async function toggle() {
    if (!id || !existing) return;
    setSaving(true);
    const nowActive = !existing.is_active;
    await fetch(`/api/admin/${entity}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: nowActive }),
    });
    setSaving(false);
    toast.success(nowActive ? "Reactivated" : "Deactivated");
    await onSaved();
  }

  const rows: FieldConfig[][] = [];
  for (let i = 0; i < ui.fields.length; ) {
    const f = ui.fields[i];
    if (f.half && ui.fields[i + 1]?.half) { rows.push([f, ui.fields[i + 1]]); i += 2; }
    else { rows.push([f]); i += 1; }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        {error ? <div className="note bad">{error}</div> : null}
        {rows.map((group, idx) => (
          <div key={idx} className={group.length > 1 ? "row" : undefined}>
            {group.map((f) => (
              <Field key={f.k} field={f} value={values[f.k]} onChange={(v) => setField(f.k, v)} customers={data.customers} routes={data.routes} disabled={!canEdit} />
            ))}
          </div>
        ))}
        {canEdit ? (
          <>
            <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : id ? "Save changes" : "Create"}</button>
            {id && ui.fields.some((f) => f.k === "is_active") ? (
              <button className="ghost danger" type="button" disabled={saving} onClick={toggle}>
                {existing?.is_active ? "Deactivate" : "Reactivate"}
              </button>
            ) : null}
          </>
        ) : null}
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
      </form>
      {entity === "routes" && id ? (
        <RouteBorderPaths
          routeId={id}
          paths={data.routeBorderPaths.filter((p) => p.route_id === id)}
          canEdit={canEdit}
          onChanged={onSaved}
        />
      ) : null}
    </>
  );
}

function RouteBorderPaths({
  routeId,
  paths,
  canEdit,
  onChanged,
}: {
  routeId: string;
  paths: RouteBorderPath[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [borders, setBorders] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/routes/${routeId}/paths`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: label.trim(),
        borders: borders.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success("Alternate path added");
    setLabel("");
    setBorders("");
    setAdding(false);
    await onChanged();
  }

  async function handleRemove(pathId: string) {
    if (!confirm("Remove this alternate path?")) return;
    const res = await fetch(`/api/admin/routes/${routeId}/paths/${pathId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed");
      await onChanged();
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Alternate border paths</h2></div>
      <div className="panel-body">
        <div className="hint" style={{ marginBottom: 10 }}>
          The route&apos;s own Borders field above is the default. Add alternates here for trips that cross elsewhere.
        </div>
        {paths.length ? (
          <ul className="list" style={{ marginBottom: canEdit ? 13 : 0 }}>
            {paths.map((p) => (
              <li key={p.id}>
                <div>
                  <div className="r-title">{p.label}</div>
                  <div className="r-mono">{p.borders.join(" → ")}</div>
                </div>
                {canEdit ? <button className="x" onClick={() => handleRemove(p.id)}>✕</button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="d-hint" style={{ marginBottom: canEdit ? 13 : 0 }}>No alternates yet — this route only has its default path.</div>
        )}
        {canEdit ? (
          adding ? (
            <form onSubmit={handleAdd}>
              {error ? <div className="note bad">{error}</div> : null}
              <div className="field">
                <label htmlFor="pathLabel">Label</label>
                <input id="pathLabel" type="text" placeholder="e.g. Via Mokambo" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pathBorders">Borders</label>
                <input id="pathBorders" type="text" placeholder="Tunduma/Nakonde, Mokambo" value={borders} onChange={(e) => setBorders(e.target.value)} />
                <div className="hint">Comma separated, in crossing order.</div>
              </div>
              <button className="primary" type="submit" disabled={saving}>{saving ? "Adding…" : "Add path"}</button>
              <button className="ghost" type="button" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          ) : (
            <button className="act" type="button" onClick={() => setAdding(true)}>+ Add alternate path</button>
          )
        ) : null}
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  customers,
  routes,
  disabled,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
  customers: Customer[];
  routes: Route[];
  disabled: boolean;
}) {
  const id = "af_" + field.k;

  let control: React.ReactNode;
  if (field.type === "bool") {
    return (
      <div className="check">
        <input type="checkbox" id={id} checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id}>{field.label}</label>
      </div>
    );
  } else if (field.type === "select") {
    control = (
      <select id={id} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {field.opts!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === "fk") {
    const src = (field.from === "customers" ? customers : routes).filter((r) => r.is_active !== false);
    control = (
      <select id={id} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {src.map((o) => <option key={o.id} value={o.id}>{(o as unknown as Record<string, string>)[field.lab!]}</option>)}
      </select>
    );
  } else if (field.type === "tags") {
    control = <input id={id} type="text" value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = (
      <input
        id={id}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
      />
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}{field.req ? " *" : ""}</label>
      {control}
      {field.hint ? <div className="hint">{field.hint}</div> : null}
    </div>
  );
}

function FxForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const currencies = ["TZS", "ZMW", "CDF", "USD", "RWF", "ZAR"];
  const [currency, setCurrency] = useState(currencies[0]);
  const [per, setPer] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const perNum = parseFloat(per);
  const valid = Number.isFinite(perNum) && perNum > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Enter how many units buy one dollar.");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/fx-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency, unitsPerUsd: perNum, effectiveOn, source: source.trim() || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success(`${currency} set at ${num(perNum)} to the dollar`);
    setPer("");
    setSource("");
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="xCur">Currency</label>
        <select id="xCur" value={currency} onChange={(e) => { setCurrency(e.target.value); if (e.target.value === "USD") setPer("1"); }}>
          {currencies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="xPer">Units per 1 USD</label>
        <input id="xPer" type="number" step="any" min="0" placeholder="2600" value={per} onChange={(e) => setPer(e.target.value)} />
        <div className="hint">Enter it the way it&apos;s quoted — how many of this currency buy one dollar.</div>
      </div>
      <div className={"mirror" + (valid ? " live" : "")}>
        <div className={"big" + (valid ? " on" : "")}>{valid ? `1 ${currency} = ${(1 / perNum).toFixed(8)} USD` : "—"}</div>
        <div className="small">
          {valid
            ? `${num(perNum)} ${currency} to the dollar. A 10,000 ${currency} border fee would post as USD ${(10000 / perNum).toFixed(2)}.`
            : "This is what gets stored and frozen onto every cost entered at this rate."}
        </div>
      </div>
      <div className="field">
        <label htmlFor="xDate">Effective from</label>
        <input id="xDate" type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="xSrc">Source</label>
        <input id="xSrc" type="text" placeholder="BoZ / bureau / bank" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Add rate"}</button>
      <div className="hint" style={{ marginTop: 9 }}>Rates are never edited — a new row supersedes the old one, and past costs keep the rate they were entered at.</div>
    </form>
  );
}
