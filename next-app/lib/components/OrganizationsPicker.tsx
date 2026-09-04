"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { setActiveOrg } from "@/app/(app)/actions";
import type { Organization } from "@/lib/types";
import { Spinner } from "@/lib/components/Spinner";

// Shared by app/(app)/organizations/page.tsx (switching/editing/creating
// once already inside some org) and app/(app)/layout.tsx's fallback for a
// platform admin who hasn't picked an org yet -- same list, same forms,
// just rendered inside different chrome by each caller.
export function OrganizationsPicker() {
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function switchOrg(id: string) {
    setSwitchingId(id);
    try {
      await setActiveOrg(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch organization");
      setSwitchingId(null);
      return;
    }
    // Full navigation -- see the identical comment in lib/components/Nav.tsx.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: a router.push transition would leave stale client-fetched state behind
    window.location.assign("/board");
  }

  async function load() {
    const res = await fetch("/api/platform/organizations");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLoadError(body.error || res.statusText);
      return;
    }
    const body = await res.json();
    setOrgs(body.organizations);
    setLoadError(null);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
  }, []);

  if (loadError) return <div className="note bad">{loadError}</div>;
  if (!orgs) return <div className="panel"><Spinner /></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Organizations</h2>
        {!creating ? (
          <button className="act" type="button" onClick={() => setCreating(true)}>+ New organization</button>
        ) : null}
      </div>
      {creating ? (
        <NewOrgForm
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <ul className="list">
          {orgs.length ? orgs.map((o) => (
            editingId === o.id ? (
              <li key={o.id} style={{ display: "block" }}>
                <EditOrgForm
                  org={o}
                  onSaved={async () => {
                    setEditingId(null);
                    await load();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={o.id}>
                <div>
                  <div className="r-title">{o.name}</div>
                  <div className="r-mono">{o.country} · {o.base_currency} · {o.trip_prefix} / {o.invoice_prefix}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button className="ghost" type="button" style={{ marginTop: 0, width: "auto" }} onClick={() => setEditingId(o.id)}>
                    Edit
                  </button>
                  <button className="act" type="button" disabled={switchingId === o.id} onClick={() => switchOrg(o.id)}>
                    {switchingId === o.id ? "Switching…" : "Switch to"}
                  </button>
                </div>
              </li>
            )
          )) : <li className="empty">No organizations yet.</li>}
        </ul>
      )}
    </div>
  );
}

function NewOrgForm({ onCreated, onCancel }: { onCreated: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [tripPrefix, setTripPrefix] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/platform/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        country: country.trim(),
        baseCurrency: baseCurrency.trim(),
        tripPrefix: tripPrefix.trim(),
        invoicePrefix: invoicePrefix.trim(),
        ownerEmail: ownerEmail.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    const body = await res.json();
    toast.success(`${body.name} created`);
    setInviteUrl(body.inviteUrl);
    await onCreated();
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Copied");
  }

  if (inviteUrl) {
    return (
      <div className="panel-body">
        <div className="note good">Organization created and its owner invited — share this link with them directly. It won&apos;t be shown again.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" readOnly value={inviteUrl} style={{ fontFamily: "var(--mono)" }} />
          <button className="act" type="button" onClick={copyLink}>Copy</button>
        </div>
        <button className="ghost" type="button" onClick={onCancel}>Done</button>
      </div>
    );
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="oName">Organization name</label>
        <input id="oName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="oCountry">Country</label>
          <input id="oCountry" type="text" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="oCur">Base currency</label>
          <input id="oCur" type="text" placeholder="USD" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="oTripPfx">Trip prefix</label>
          <input id="oTripPfx" type="text" placeholder="e.g. ACME" value={tripPrefix} onChange={(e) => setTripPrefix(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="oInvPfx">Invoice prefix</label>
          <input id="oInvPfx" type="text" placeholder="e.g. ACME-INV" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="oOwner">First owner&apos;s email</label>
        <input id="oOwner" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
      </div>
      <button className="primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create organization"}</button>
      <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function EditOrgForm({
  org,
  onSaved,
  onCancel,
}: {
  org: Organization;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [country, setCountry] = useState(org.country);
  const [baseCurrency, setBaseCurrency] = useState(org.base_currency);
  const [tripPrefix, setTripPrefix] = useState(org.trip_prefix);
  const [invoicePrefix, setInvoicePrefix] = useState(org.invoice_prefix);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/platform/organizations/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        country: country.trim(),
        base_currency: baseCurrency.trim(),
        trip_prefix: tripPrefix.trim(),
        invoice_prefix: invoicePrefix.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success("Organization updated");
    await onSaved();
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit} style={{ padding: "13px 0 0" }}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="eoName">Organization name</label>
        <input id="eoName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="eoCountry">Country</label>
          <input id="eoCountry" type="text" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="eoCur">Base currency</label>
          <input id="eoCur" type="text" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="eoTripPfx">Trip prefix</label>
          <input id="eoTripPfx" type="text" value={tripPrefix} onChange={(e) => setTripPrefix(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="eoInvPfx">Invoice prefix</label>
          <input id="eoInvPfx" type="text" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} />
        </div>
      </div>
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}
