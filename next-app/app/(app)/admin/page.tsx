"use client";

import { useEffect, useState, type FormEvent } from "react";
import { num, today } from "@/lib/format";
import type { BootstrapPayload, Customer, Route, FxRate } from "@/lib/types";

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

// Client-side UI config only -- labels, hints, field types, select options.
// Deliberately NOT the security boundary (that's lib/admin/entities.ts,
// server-only); this just drives what the form looks like.
const ENT_UI: Record<string, { label: string; fields: FieldConfig[]; row: (r: Record<string, unknown>, data: BootstrapPayload) => RowView }> = {
  customers: {
    label: "Customers",
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

const VIEWS = ["fx", "customers", "trucks", "drivers", "routes", "rate_cards"] as const;
type ViewKey = (typeof VIEWS)[number];
const VIEW_LABELS: Record<ViewKey, string> = {
  fx: "Exchange rates", customers: "Customers", trucks: "Trucks", drivers: "Drivers", routes: "Routes", rate_cards: "Rate cards",
};

export default function AdminPage() {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [view, setView] = useState<ViewKey>("fx");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const res = await fetch("/api/bootstrap");
    setData(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
  }, []);

  if (!data) return <div className="panel"><div className="empty">Loading…</div></div>;

  const masters: Record<string, unknown[]> = {
    customers: data.customers, trucks: data.trucks, drivers: data.drivers, routes: data.routes, rate_cards: data.rateCards,
  };

  return (
    <>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <button
            key={v}
            className={"chip" + (view === v ? " on" : "")}
            onClick={() => { setView(v); setSelected(null); setCreating(false); }}
          >
            {VIEW_LABELS[v]}<span className="c">{v === "fx" ? data.fx.length : masters[v].length}</span>
          </button>
        ))}
      </div>
      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h2>{VIEW_LABELS[view]}</h2>
            {view !== "fx" ? <button className="act" onClick={() => { setSelected(null); setCreating(true); }}>+ New</button> : null}
          </div>
          {view === "fx" ? (
            <FxList fx={data.fx} />
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
          <div className="panel-head"><h2>{view === "fx" ? "Add a rate" : selected ? "Edit" : creating ? "New" : "Detail"}</h2></div>
          <div className="panel-body">
            {view === "fx" ? (
              <FxForm onSaved={load} />
            ) : creating || selected ? (
              <EntityForm
                entity={view}
                id={selected}
                data={data}
                onSaved={async () => { await load(); setSelected(null); setCreating(false); }}
                onCancel={() => { setSelected(null); setCreating(false); }}
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
}: {
  entity: ViewKey;
  id: string | null;
  data: BootstrapPayload;
  onSaved: () => Promise<void>;
  onCancel: () => void;
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
    await onSaved();
  }

  async function toggle() {
    if (!id || !existing) return;
    setSaving(true);
    await fetch(`/api/admin/${entity}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !existing.is_active }),
    });
    setSaving(false);
    await onSaved();
  }

  const rows: FieldConfig[][] = [];
  for (let i = 0; i < ui.fields.length; ) {
    const f = ui.fields[i];
    if (f.half && ui.fields[i + 1]?.half) { rows.push([f, ui.fields[i + 1]]); i += 2; }
    else { rows.push([f]); i += 1; }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      {rows.map((group, idx) => (
        <div key={idx} className={group.length > 1 ? "row" : undefined}>
          {group.map((f) => (
            <Field key={f.k} field={f} value={values[f.k]} onChange={(v) => setField(f.k, v)} customers={data.customers} routes={data.routes} />
          ))}
        </div>
      ))}
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : id ? "Save changes" : "Create"}</button>
      {id && ui.fields.some((f) => f.k === "is_active") ? (
        <button className="ghost danger" type="button" disabled={saving} onClick={toggle}>
          {existing?.is_active ? "Deactivate" : "Reactivate"}
        </button>
      ) : null}
      <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function Field({
  field,
  value,
  onChange,
  customers,
  routes,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
  customers: Customer[];
  routes: Route[];
}) {
  const id = "af_" + field.k;

  let control: React.ReactNode;
  if (field.type === "bool") {
    return (
      <div className="check">
        <input type="checkbox" id={id} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id}>{field.label}</label>
      </div>
    );
  } else if (field.type === "select") {
    control = (
      <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {field.opts!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === "fk") {
    const src = (field.from === "customers" ? customers : routes).filter((r) => r.is_active !== false);
    control = (
      <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {src.map((o) => <option key={o.id} value={o.id}>{(o as unknown as Record<string, string>)[field.lab!]}</option>)}
      </select>
    );
  } else if (field.type === "tags") {
    control = <input id={id} type="text" value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = (
      <input
        id={id}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={String(value ?? "")}
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
