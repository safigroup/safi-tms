"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { m2, lab, today } from "@/lib/format";
import { prepareFile } from "@/lib/imagePrep";
import { saveCostDraft, loadCostDraft, clearCostDraft, type CostDraft } from "@/lib/costDraft";
import { Spinner } from "@/lib/components/Spinner";
import type { BootstrapPayload, BoardTrip, TripCost, TripDocument } from "@/lib/types";

const CATS = [
  "fuel", "driver_advance", "driver_allowance", "border_fees", "customs_duty",
  "clearing_agent", "tolls", "weighbridge", "permits", "escort", "demurrage",
  "detention", "repairs", "tyres", "police", "other",
];
const DOCTYPES = [
  "pod", "consignment_note", "cmr", "packing_list", "t1_transit", "customs_entry",
  "delivery_note", "weighbridge_ticket", "insurance", "permit", "other",
];

const emptyDraft: CostDraft = { cat: CATS[0], amt: "", cur: "", when: today(), desc: "", loc: "", paid: "driver_float", ref: "", liters: "", pricePerLiter: "" };

// Mirrors lib/auth/permissions.ts's CAN_MANAGE_TRIPS -- UI convenience only
// (hides actions a role can't use), the route handlers are the real check.
const CAN_MANAGE_TRIPS = ["owner", "admin", "ops"];

export default function DocketPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [costs, setCosts] = useState<TripCost[]>([]);
  const [documents, setDocuments] = useState<TripDocument[]>([]);
  const [tab, setTab] = useState<"ledger" | "docs">("ledger");
  const [draft, setDraft] = useState<CostDraft>(emptyDraft);
  const [restoredNote, setRestoredNote] = useState(false);
  const [costFile, setCostFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formNote, setFormNote] = useState<string | null>(null);

  async function loadBootstrap() {
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
    const open = payload.board.filter((t) => !["closed", "cancelled" as string].includes(t.status));
    const wanted = searchParams.get("trip");
    if (wanted && open.some((t) => t.trip_id === wanted)) {
      setTripId(wanted);
    } else if (open.length) {
      setTripId((cur) => cur ?? open[0].trip_id);
    }
  }

  async function loadDetail(id: string) {
    const res = await fetch(`/api/trips/${id}/detail`);
    if (!res.ok) {
      setLoadError("Couldn't load this trip's costs/documents — try refreshing.");
      return;
    }
    const body = await res.json();
    setCosts(body.costs ?? []);
    setDocuments(body.documents ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; loadBootstrap is recreated every render, adding it here would refetch on every render too
  }, []);

  useEffect(() => {
    if (!tripId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching this trip's costs/documents when the selected trip changes
    loadDetail(tripId);
    const d = loadCostDraft(tripId);
    if (d) {
      // Spread over emptyDraft so a draft saved before liters/pricePerLiter
      // existed doesn't come back with those fields undefined.
      setDraft({ ...emptyDraft, ...d });
      setRestoredNote(true);
    } else {
      setDraft(emptyDraft);
      setRestoredNote(false);
    }
  }, [tripId]);

  function updateDraft(patch: Partial<CostDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (tripId) saveCostDraft(tripId, next);
  }

  function updateFuelField(patch: Partial<Pick<CostDraft, "liters" | "pricePerLiter">>) {
    const liters = parseFloat(patch.liters ?? draft.liters);
    const price = parseFloat(patch.pricePerLiter ?? draft.pricePerLiter);
    const amt = Number.isFinite(liters) && liters > 0 && Number.isFinite(price) && price > 0
      ? (liters * price).toFixed(2)
      : draft.amt;
    updateDraft({ ...patch, amt });
  }

  if (!data) return <div className="panel"><Spinner /></div>;

  const open = data.board.filter((t) => !["closed", "cancelled"].includes(t.status));
  const trip = data.board.find((t) => t.trip_id === tripId) || null;

  // USD is always a valid entry currency (no conversion needed), whether
  // or not the org has ever bothered to add a redundant "1 USD = 1 USD"
  // row to fx_rates.
  const curOpts = Array.from(new Set([...data.fx.map((r) => r.currency), "USD"])).sort((a, b) => {
    const order = ["USD", "TZS", "ZMW", "CDF"];
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const fxRate = data.fx.find((r) => r.currency === draft.cur);
  const rateToUsd = draft.cur === "USD" ? 1 : fxRate?.rate_to_usd;
  const amtNum = parseFloat(draft.amt);
  const canWrite = CAN_MANAGE_TRIPS.includes(data.role);

  async function handleSaveCost(e: FormEvent) {
    e.preventDefault();
    if (!tripId) return;
    setFormNote(null);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      return setFormNote("Enter an amount greater than zero.");
    }
    if (rateToUsd === undefined) {
      return setFormNote(`No exchange rate on file for ${draft.cur}.`);
    }

    setSaving(true);
    try {
      let receiptPath: string | null = null;
      if (costFile) {
        const ready = await prepareFile(costFile);
        const form = new FormData();
        form.append("file", ready);
        form.append("tripId", tripId);
        const uploadRes = await fetch("/api/storage/upload", { method: "POST", body: form });
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({}));
          throw new Error(body.error || "upload failed");
        }
        receiptPath = (await uploadRes.json()).path;
      }

      const res = await fetch("/api/trip-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          category: draft.cat,
          amount: amtNum,
          currency: draft.cur,
          incurredOn: draft.when,
          description: draft.desc.trim() || null,
          location: draft.loc.trim() || null,
          paidBy: draft.paid,
          receiptRef: draft.ref.trim() || null,
          receiptPath,
          liters: draft.cat === "fuel" ? draft.liters || null : null,
          pricePerLiter: draft.cat === "fuel" ? draft.pricePerLiter || null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }

      toast.success(`${m2(amtNum, draft.cur)} → ${m2(amtNum * rateToUsd)}`);
      clearCostDraft(tripId);
      setDraft({ ...emptyDraft, cat: draft.cat, cur: draft.cur, when: draft.when, paid: draft.paid });
      setCostFile(null);
      await loadDetail(tripId);
      await loadBootstrap();
    } catch (err) {
      setFormNote("Couldn't save: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCost(id: string) {
    if (!confirm("Remove this cost entry?")) return;
    const res = await fetch(`/api/trip-costs/${id}`, { method: "DELETE" });
    if (res.ok && tripId) {
      toast.success("Cost entry removed");
      await loadDetail(tripId);
      await loadBootstrap();
    }
  }

  async function openFile(costId?: string, docId?: string) {
    const qs = costId ? `costId=${costId}` : `docId=${docId}`;
    const res = await fetch(`/api/storage/signed-url?${qs}`);
    if (!res.ok) return;
    const { url } = await res.json();
    window.open(url, "_blank", "noopener");
  }

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <div className="grid">
      <div className="panel">
        <div className="panel-head"><h2>Record a cost</h2></div>
        {!canWrite ? (
          <div className="empty">You have read-only access to this section.</div>
        ) : (
        <form className="panel-body" onSubmit={handleSaveCost}>
          {formNote ? <div className="note bad">{formNote}</div> : null}
          {restoredNote ? <div className="note warn">Restored an unsaved draft from earlier — the receipt photo wasn&apos;t kept, re-attach it if needed.</div> : null}
          <div className="field">
            <label htmlFor="trip">Trip</label>
            <select id="trip" value={tripId ?? ""} onChange={(e) => setTripId(e.target.value)}>
              {open.map((t) => (
                <option key={t.trip_id} value={t.trip_id}>{t.trip_no} — {t.customer} — {t.route}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cat">Category</label>
            <select id="cat" value={draft.cat} onChange={(e) => updateDraft({ cat: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{lab(c).replace(/^./, (x) => x.toUpperCase())}</option>)}
            </select>
          </div>
          {draft.cat === "fuel" ? (
            <div className="row">
              <div className="field">
                <label htmlFor="liters">Liters</label>
                <input id="liters" type="number" step="0.01" min="0" placeholder="0.00" inputMode="decimal" value={draft.liters} onChange={(e) => updateFuelField({ liters: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="pricePerLiter">Price per liter</label>
                <input id="pricePerLiter" type="number" step="0.0001" min="0" placeholder="0.00" inputMode="decimal" value={draft.pricePerLiter} onChange={(e) => updateFuelField({ pricePerLiter: e.target.value })} />
              </div>
            </div>
          ) : null}
          <div className="row3">
            <div className="field">
              <label htmlFor="amt">Amount</label>
              <input id="amt" type="number" step="0.01" min="0" placeholder="0.00" inputMode="decimal" value={draft.amt} onChange={(e) => updateDraft({ amt: e.target.value })} />
              {draft.cat === "fuel" && draft.liters && draft.pricePerLiter ? (
                <div className="hint">Auto-filled from liters × price — edit directly to override.</div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="cur">Currency</label>
              <select id="cur" value={draft.cur} onChange={(e) => updateDraft({ cur: e.target.value })}>
                {curOpts.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="when">Date</label>
              <input id="when" type="date" value={draft.when} onChange={(e) => updateDraft({ when: e.target.value })} />
            </div>
          </div>
          <div className={"stamp" + (Number.isFinite(amtNum) && amtNum > 0 ? " live" : "")}>
            <span className="native">{Number.isFinite(amtNum) && amtNum > 0 ? m2(amtNum, draft.cur) : "—"}</span>
            <span className="arrow">→</span>
            <span className={"usd" + (Number.isFinite(amtNum) && amtNum > 0 ? "" : " idle")}>
              {Number.isFinite(amtNum) && amtNum > 0 && rateToUsd !== undefined ? m2(amtNum * rateToUsd) : "USD 0.00"}
            </span>
            <span className="rate">
              {draft.cur === "USD"
                ? "Recorded directly in USD — no conversion needed."
                : fxRate
                  ? <>Rate on file <b>1 {draft.cur} = {Number(fxRate.rate_to_usd).toFixed(8)} USD</b> · dated {fxRate.effective_on} · frozen onto this entry</>
                  : `No rate on file for ${draft.cur}.`}
            </span>
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <input id="desc" type="text" placeholder="e.g. Tunduma crossing charges" value={draft.desc} onChange={(e) => updateDraft({ desc: e.target.value })} />
          </div>
          <div className="row3">
            <div className="field">
              <label htmlFor="loc">Location</label>
              <input id="loc" type="text" placeholder="Nakonde" value={draft.loc} onChange={(e) => updateDraft({ loc: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="paid">Paid by</label>
              <select id="paid" value={draft.paid} onChange={(e) => updateDraft({ paid: e.target.value })}>
                <option value="driver_float">Driver float</option>
                <option value="office">Office</option>
                <option value="agent">Agent</option>
                <option value="card">Card</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ref">Receipt ref</label>
              <input id="ref" type="text" value={draft.ref} onChange={(e) => updateDraft({ ref: e.target.value })} />
            </div>
          </div>
          <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-soft)", marginBottom: 5 }}>
            Receipt photo
          </label>
          <CaptureField
            file={costFile}
            onChange={setCostFile}
            idleText="Optional — but a float can't be reconciled without one."
          />
          <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save cost"}</button>
        </form>
        )}
      </div>
      <div className="panel">
        {trip ? (
          <div className="d-head">
            <div className="r-no">{trip.trip_no} · <span className="pill grey">{lab(trip.status)}</span></div>
            <div className="r-title" style={{ fontSize: 18 }}>{trip.customer}</div>
            <div className="r-sub">{trip.route}{trip.fleet_no ? " · " + trip.fleet_no : ""}</div>
            <div className="d-figs">
              <div><div className="k">Revenue</div><div className="v">{m2(trip.revenue_usd)}</div></div>
              <div><div className="k">Costs</div><div className="v">{m2(trip.cost_usd)}</div></div>
              <div><div className="k">Margin</div><div className={"v " + (Number(trip.margin_usd) >= 0 ? "pos" : "neg")}>{m2(trip.margin_usd)}</div></div>
            </div>
          </div>
        ) : null}
        <div className="tabs">
          <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>
            Ledger {costs.length ? <span className="c">({costs.length})</span> : null}
          </button>
          <button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}>
            Documents {documents.filter((d) => d.status === "pending").length ? <span className="badge">{documents.filter((d) => d.status === "pending").length}</span> : null}
          </button>
        </div>
        {tab === "ledger" ? (
          <ul className="list">
            {costs.length ? costs.map((c) => (
              <li key={c.id}>
                <div>
                  <div className="r-no" style={{ color: "var(--stamp)" }}>{lab(c.category)}</div>
                  <div style={{ fontSize: 13, marginTop: 1 }}>{c.description || "—"}</div>
                  <div className="r-mono">
                    {c.incurred_on}{c.location ? " · " + c.location : ""}{c.receipt_ref ? " · " + c.receipt_ref : ""}
                    {c.liters ? ` · ${c.liters} L @ ${c.price_per_liter}` : ""}
                    {c.receipt_path ? <> · <a href="#" onClick={(e) => { e.preventDefault(); openFile(c.id); }}>receipt</a></> : null}
                  </div>
                </div>
                <div className="r-right">
                  <div className="r-amt">{m2(c.amount_usd)}</div>
                  <div className="r-min">{c.currency !== "USD" ? m2(c.amount, c.currency) : " "}</div>
                </div>
                {canWrite ? <button className="x" onClick={() => handleDeleteCost(c.id)}>✕</button> : null}
              </li>
            )) : <li className="empty">No costs recorded on this trip yet.</li>}
          </ul>
        ) : (
          <DocsTab
            trip={trip}
            documents={documents}
            tripId={tripId}
            onOpen={(docId) => openFile(undefined, docId)}
            onChanged={async () => { if (tripId) { await loadDetail(tripId); await loadBootstrap(); } }}
            canWrite={canWrite}
          />
        )}
      </div>
      </div>
      {canWrite ? (
        <BulkImportForm
          onImported={async () => {
            await loadBootstrap();
            if (tripId) await loadDetail(tripId);
          }}
        />
      ) : null}
    </>
  );
}

function BulkImportForm({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; errors: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return setError("Choose a file to upload.");
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/trip-costs/bulk", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setResult(body);
      if (body.inserted) {
        toast.success(`${body.inserted} cost${body.inserted === 1 ? "" : "s"} imported`);
        await onImported();
      }
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h2>Bulk import trip costs</h2>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- downloads a file from an API route, not a page transition; next/link doesn't apply */}
        <a className="act" href="/api/trip-costs/bulk-template">Download template</a>
      </div>
      <form className="panel-body" onSubmit={handleUpload}>
        {error ? <div className="note bad">{error}</div> : null}
        <div className="field">
          <label htmlFor="bulkFile">CSV or Excel file</label>
          <input ref={inputRef} id="bulkFile" type="file" accept=".csv,.xlsx" />
        </div>
        <button className="primary" type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</button>
        {result ? (
          <div style={{ marginTop: 13 }}>
            {result.inserted ? (
              <div className="note good">{result.inserted} cost{result.inserted === 1 ? "" : "s"} imported.</div>
            ) : null}
            {result.errors.length ? (
              <div className="note bad">
                {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped:
                <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                  {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function CaptureField({
  file,
  onChange,
  idleText,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  idleText: string;
}) {
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setPreparing(true);
    const ready = await prepareFile(raw);
    setPreparing(false);
    onChange(ready);
  }

  return (
    <div className={"capture" + (file ? " has" : "")}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" capture="environment" onChange={handleFile} style={{ display: "none" }} />
      <button className="btn" type="button" onClick={() => inputRef.current?.click()}>Attach</button>
      {file && file.type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element -- ephemeral local object URL preview, not worth next/image's remote-optimization machinery
        <img className="thumb" src={URL.createObjectURL(file)} alt="" />
      ) : null}
      <span className="state">
        {preparing ? "Preparing…" : file ? <><b>{file.name}</b> · {(file.size / 1024).toFixed(0)} KB</> : idleText}
      </span>
      {file ? <button className="clear" type="button" onClick={() => onChange(null)}>✕</button> : null}
    </div>
  );
}

function DocsTab({
  trip,
  documents,
  tripId,
  onOpen,
  onChanged,
  canWrite,
}: {
  trip: BoardTrip | null;
  documents: TripDocument[];
  tripId: string | null;
  onOpen: (docId: string) => void;
  onChanged: () => Promise<void>;
  canWrite: boolean;
}) {
  const [docType, setDocType] = useState(DOCTYPES[0]);
  const [docNumber, setDocNumber] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pod = documents.find((d) => d.doc_type === "pod");
  const podDone = pod?.status === "received";
  const showPodCall = !podDone && trip && ["delivered", "in_transit", "at_border"].includes(trip.status);

  async function markPod() {
    if (!pod || !tripId) return;
    const res = await fetch(`/api/trip-documents/${pod.id}/mark-pod`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId }),
    });
    if (res.ok) {
      toast.success("POD received — delivery invoice unlocked");
      await onChanged();
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!docFile || !tripId) return setNote("Choose a file to upload.");
    setSaving(true);
    setNote(null);
    try {
      const ready = await prepareFile(docFile);
      const form = new FormData();
      form.append("file", ready);
      form.append("tripId", tripId);
      const uploadRes = await fetch("/api/storage/upload", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error((await uploadRes.json().catch(() => ({}))).error || "upload failed");
      const { path } = await uploadRes.json();

      const res = await fetch("/api/trip-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, docType, storagePath: path, docNumber: docNumber.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);

      toast.success("Document uploaded");
      setDocNumber("");
      setDocFile(null);
      await onChanged();
    } catch (err) {
      setNote("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {showPodCall && canWrite ? (
        <div className="pod-call">
          <p>The delivery half can&apos;t be invoiced until the POD is in hand. Upload it below, then <b>mark it received</b>.</p>
          <button className="primary settle" disabled={!pod?.storage_path} onClick={markPod}>Mark POD received</button>
        </div>
      ) : null}
      <ul className="list">
        {documents.length ? documents.map((d) => (
          <li key={d.id}>
            <div>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, letterSpacing: ".04em", textTransform: "uppercase" }}>{lab(d.doc_type)}</div>
              <div className="r-mono">{d.doc_number || "no number"}{d.issued_on ? " · issued " + d.issued_on : ""}{d.received_on ? " · received " + d.received_on : ""}</div>
              <div className="r-mono">
                {d.storage_path ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(d.id); }}>view file</a> : "no file attached"}
              </div>
            </div>
            <span className={"pill " + ({ pending: "warn", issued: "violet", lodged: "violet", cleared: "good", received: "good", rejected: "bad" }[d.status] || "grey")}>
              {d.status}
            </span>
          </li>
        )) : <li className="empty">No documents on this trip yet.</li>}
      </ul>
      {canWrite ? (
        <form className="panel-body" style={{ background: "#F2F3EE", borderTop: "1px solid var(--rule)" }} onSubmit={handleUpload}>
          {note ? <div className="note bad">{note}</div> : null}
          <div className="field">
            <label htmlFor="dType">Add or replace a document</label>
            <select id="dType" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOCTYPES.map((d) => <option key={d} value={d}>{lab(d).replace(/^./, (x) => x.toUpperCase())}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dNum">Document number</label>
            <input id="dNum" type="text" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </div>
          <CaptureField file={docFile} onChange={setDocFile} idleText="Photo or PDF." />
          <button className="primary" type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload document"}</button>
        </form>
      ) : null}
    </div>
  );
}
