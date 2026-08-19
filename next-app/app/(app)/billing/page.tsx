"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, lab, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import type { ArInvoice, BillableTrip, BootstrapPayload } from "@/lib/types";

const BUCKETS: [string, string, (i: ArInvoice) => boolean][] = [
  ["open", "Unpaid", (i) => Number(i.outstanding) > 0],
  ["current", "Current", (i) => i.bucket === "current"],
  ["b1", "1–30", (i) => i.bucket === "1-30"],
  ["b2", "31–60", (i) => i.bucket === "31-60"],
  ["b3", "60+", (i) => i.bucket === "60+"],
  ["settled", "Settled", (i) => i.bucket === "settled"],
  ["cancelled", "Cancelled", (i) => i.bucket === "cancelled"],
  ["all", "All", () => true],
];

type InvoiceDetail = {
  invoice: {
    id: string;
    invoice_no: string;
    invoice_type: string;
    currency: string;
    subtotal: number;
    total_due: number;
    issued_on: string;
    due_on: string;
    customers: { name: string; country: string | null; tpin: string | null; contact_email: string | null; payment_terms: string | null } | null;
  };
  lines: { description: string; quantity: number; unit_price: number; line_total: number }[];
  payments: { amount: number; currency: string; received_on: string; method: string | null; reference: string | null }[];
};

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"bill" | "inv">("bill");
  const [bucket, setBucket] = useState("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [printData, setPrintData] = useState<InvoiceDetail | null>(null);

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load is recreated every render, adding it here would refetch on every render too
  }, []);

  useEffect(() => {
    if (printData) window.print();
  }, [printData]);

  if (!data) return <div className="panel"><Spinner /></div>;

  const out = data.ar.filter((i) => Number(i.outstanding) > 0);
  const overdue = out.filter((i) => i.days_overdue > 0);
  const totalOut = out.reduce((s, i) => s + Number(i.outstanding), 0);
  const totalOver = overdue.reduce((s, i) => s + Number(i.outstanding), 0);
  const raisable = data.billable.reduce(
    (s, t) => s + (!t.loading_invoiced ? Number(t.half_usd) : 0) + (t.pod_in_hand && !t.delivery_invoiced ? Number(t.half_usd) : 0),
    0,
  );
  const blocked = data.billable.filter((t) => !t.pod_in_hand && t.loading_invoiced);
  const blockedVal = blocked.reduce((s, t) => s + Number(t.half_usd), 0);

  const bucketFn = BUCKETS.find((b) => b[0] === bucket)![2];
  const invRows = data.ar.filter(bucketFn);

  async function printInvoice(id: string) {
    const res = await fetch(`/api/invoices/${id}`);
    if (!res.ok) return;
    const body: InvoiceDetail = await res.json();
    setPrintData(body);
  }

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <div className="strip">
        <div className="cell"><div className="k">Ready to raise</div><div className="v pos">{m0(raisable)}</div><div className="n">{data.billable.length} trip{data.billable.length === 1 ? "" : "s"}</div></div>
        <div className="cell"><div className="k">Blocked on POD</div><div className={"v" + (blocked.length ? " warn" : "")}>{m0(blockedVal)}</div><div className="n">{blocked.length} delivered, no POD</div></div>
        <div className="cell"><div className="k">Outstanding</div><div className="v">{m0(totalOut)}</div><div className="n">{out.length} unpaid</div></div>
        <div className="cell"><div className="k">Overdue</div><div className={"v" + (overdue.length ? " bad" : "")}>{m0(totalOver)}</div><div className="n">{overdue.length ? overdue.length + " past due" : "nothing past due"}</div></div>
      </div>
      <div className="grid">
        <div className="panel">
          <div className="tabs">
            <button className={tab === "bill" ? "on" : ""} onClick={() => { setTab("bill"); setSelected(null); }}>
              Ready to bill {data.billable.length ? <span className="c">{data.billable.length}</span> : null}
            </button>
            <button className={tab === "inv" ? "on" : ""} onClick={() => { setTab("inv"); setSelected(null); }}>
              Receivables {out.length ? <span className="c">{out.length}</span> : null}
            </button>
          </div>
          {tab === "inv" ? (
            <div className="chips">
              {BUCKETS.map(([key, label, fn]) => (
                <button key={key} className={"chip" + (bucket === key ? " on" : "")} onClick={() => setBucket(key)}>
                  {label}<span className="c">{data.ar.filter(fn).length}</span>
                </button>
              ))}
            </div>
          ) : null}
          <ul className="list">
            {tab === "bill" ? (
              data.billable.length ? data.billable.map((t) => {
                const tags = [
                  !t.loading_invoiced ? <span key="l" className="pill violet">loading half due</span> : null,
                  t.pod_in_hand && !t.delivery_invoiced ? <span key="d" className="pill good">delivery half due</span> : null,
                  !t.pod_in_hand && t.loading_invoiced ? <span key="w" className="pill warn">waiting on POD</span> : null,
                ].filter(Boolean);
                return (
                  <li key={t.trip_id} className={"tap" + (selected === t.trip_id ? " sel" : "")} onClick={() => setSelected(t.trip_id)}>
                    <div>
                      <div className="r-no">{t.trip_no}</div>
                      <div className="r-title">{t.customer}</div>
                      <div className="r-sub">{t.route}</div>
                      <div className="r-tags">{tags}</div>
                    </div>
                    <div className="r-right">
                      <div className="r-amt">{m0(t.revenue_usd)}</div>
                      <div className="r-min">half {m0(t.half_usd)}</div>
                    </div>
                  </li>
                );
              }) : <li className="empty">Nothing waiting to be billed.</li>
            ) : (
              invRows.length ? invRows.map((i) => {
                const st = Number(i.outstanding) <= 0 ? "good" : i.days_overdue > 0 ? "bad" : "violet";
                return (
                  <li key={i.id} className={"tap" + (selected === i.id ? " sel" : "")} onClick={() => setSelected(i.id)}>
                    <div>
                      <div className="r-no">{i.invoice_no} · {i.trips || ""}</div>
                      <div className="r-title">{i.customer}</div>
                      <div className="r-sub">{lab(i.invoice_type)} · issued {i.issued_on}</div>
                      <div className="r-tags">
                        <span className={"pill " + st}>{Number(i.outstanding) <= 0 ? "settled" : lab(i.status)}</span>
                        {i.days_overdue > 0 ? <span className="pill bad">{i.days_overdue}d overdue</span> : null}
                      </div>
                    </div>
                    <div className="r-right">
                      <div className="r-amt">{m0(i.outstanding, i.currency)}</div>
                      <div className="r-min">of {m0(i.total_due, i.currency)}</div>
                    </div>
                  </li>
                );
              }) : <li className="empty">Nothing here.</li>
            )}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Detail</h2></div>
          {tab === "bill" && selected ? (
            <RaiseInvoicePanel
              trip={data.billable.find((t) => t.trip_id === selected)!}
              onRaised={async (invoiceId) => {
                await load();
                setTab("inv");
                setSelected(invoiceId);
              }}
            />
          ) : tab === "inv" && selected ? (
            <InvoiceDetailPanel
              invoiceId={selected}
              ar={data.ar}
              onChanged={load}
              onPrint={() => printInvoice(selected)}
            />
          ) : (
            <div className="empty">Pick a trip to bill, or an invoice to settle.</div>
          )}
        </div>
      </div>
      {printData ? <PrintSheet detail={printData} onDone={() => setPrintData(null)} /> : null}
    </>
  );
}

function RaiseInvoicePanel({ trip, onRaised }: { trip: BillableTrip; onRaised: (invoiceId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function raise(type: "loading" | "delivery" | "full") {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/invoices/raise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: trip.trip_id, type }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setNote(body.error || res.statusText);
    }
    const { id } = await res.json();
    toast.success("Invoice raised");
    await onRaised(id);
  }

  return (
    <>
      <div className="d-head">
        <div className="r-no">{trip.trip_no}</div>
        <div className="r-title" style={{ fontSize: 18 }}>{trip.customer}</div>
        <div className="r-sub">{trip.route}</div>
        <div className="d-figs">
          <div><div className="k">Freight</div><div className="v">{m2(trip.revenue_usd)}</div></div>
          <div><div className="k">Each half</div><div className="v">{m2(trip.half_usd)}</div></div>
          <div><div className="k">POD</div><div className={"v" + (trip.pod_in_hand ? " pos" : "")}>{trip.pod_in_hand ? "in hand" : "—"}</div></div>
        </div>
      </div>
      <div className="d-sec">
        <h3>Raise</h3>
        {note ? <div className="note bad">{note}</div> : null}
        <div className="acts">
          <button className="act" disabled={busy || trip.loading_invoiced} onClick={() => raise("loading")}>
            {trip.loading_invoiced ? "Loading half raised" : "Loading half"}
          </button>
          <button className="act go" disabled={busy || !trip.pod_in_hand || trip.delivery_invoiced} onClick={() => raise("delivery")}>
            {trip.delivery_invoiced ? "Delivery half raised" : "Delivery half"}
          </button>
          <button className="act" disabled={busy || trip.loading_invoiced || trip.delivery_invoiced} onClick={() => raise("full")}>
            Full amount
          </button>
        </div>
        {!trip.pod_in_hand ? (
          <div className="d-hint" style={{ marginTop: 10 }}>
            The delivery half stays locked until the POD is marked received.
          </div>
        ) : null}
      </div>
    </>
  );
}

function InvoiceDetailPanel({
  invoiceId,
  ar,
  onChanged,
  onPrint,
}: {
  invoiceId: string;
  ar: ArInvoice[];
  onChanged: () => Promise<void>;
  onPrint: () => void;
}) {
  const i = ar.find((x) => x.id === invoiceId);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [payAmt, setPayAmt] = useState(i ? Number(i.outstanding).toFixed(2) : "");
  const [payDate, setPayDate] = useState(today());
  const [payMethod, setPayMethod] = useState("Bank transfer");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (!i) return null;

  const cancelled = i.status === "cancelled";
  const settled = Number(i.outstanding) <= 0;
  const paid = Number(i.paid) || 0;

  async function confirmCancel() {
    if (!reason.trim()) return setCancelNote("A reason is required.");
    setCancelling(true);
    const res = await fetch(`/api/invoices/${invoiceId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setCancelling(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setCancelNote(body.error || res.statusText);
    }
    toast.success("Invoice cancelled");
    setShowCancel(false);
    await onChanged();
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    const amt = parseFloat(payAmt);
    if (isNaN(amt) || amt <= 0) return setPayNote("Enter an amount greater than zero.");
    setPaying(true);
    setPayNote(null);
    const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt, receivedOn: payDate, method: payMethod, reference: payRef.trim() || null }),
    });
    setPaying(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setPayNote("Couldn't record it: " + (body.error || res.statusText));
    }
    toast.success("Payment recorded");
    await onChanged();
  }

  return (
    <>
      <div className="d-head">
        <div className="r-no">{i.invoice_no}{cancelled ? <> · <span className="pill bad">cancelled</span></> : null}</div>
        <div className="r-title" style={{ fontSize: 18 }}>{i.customer}</div>
        <div className="r-sub">{lab(i.invoice_type)} · {i.trips || ""}</div>
        <div className="d-figs">
          <div><div className="k">Invoiced</div><div className="v">{m2(i.total_due, i.currency)}</div></div>
          <div><div className="k">Paid</div><div className="v pos">{m2(i.paid, i.currency)}</div></div>
          <div><div className="k">Outstanding</div><div className={"v " + (settled ? "pos" : i.days_overdue > 0 ? "bad" : "")}>{m2(i.outstanding, i.currency)}</div></div>
        </div>
      </div>
      {cancelled ? (
        <div className="d-sec">
          <h3>Cancelled</h3>
          <div className="d-hint">{i.cancelled_at ? i.cancelled_at.slice(0, 10) : ""} — {i.cancel_reason || "no reason recorded"}</div>
        </div>
      ) : null}
      <div className="d-sec">
        <div className="acts">
          <button className="act" onClick={onPrint}>Print / PDF</button>
          {!cancelled && paid === 0 ? (
            <button className="act" style={{ borderColor: "var(--alert)", color: "var(--alert)" }} onClick={() => setShowCancel(true)}>
              Cancel invoice
            </button>
          ) : null}
        </div>
        {!cancelled && paid > 0 ? (
          <div className="d-hint" style={{ marginTop: 9 }}>Can&apos;t be cancelled — {m2(paid, i.currency)} has already been recorded against it.</div>
        ) : null}
        {showCancel ? (
          <div className="panel-body" style={{ background: "#FAEFEC", borderTop: "1px solid var(--alert)", marginTop: 9 }}>
            {cancelNote ? <div className="note bad">{cancelNote}</div> : null}
            <div className="field">
              <label htmlFor="cReason">Reason for cancelling</label>
              <input id="cReason" type="text" placeholder="e.g. raised against the wrong customer" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button className="primary" style={{ background: "var(--alert)" }} disabled={cancelling} onClick={confirmCancel}>
              {cancelling ? "Cancelling…" : "Confirm cancellation"}
            </button>
            <button className="ghost" onClick={() => setShowCancel(false)}>Never mind</button>
          </div>
        ) : null}
      </div>
      <div className="d-sec">
        <h3>Terms</h3>
        <div className="d-kv"><span>Issued</span><span>{i.issued_on}</span></div>
        <div className="d-kv"><span>Due</span><span>{i.due_on}{i.days_overdue > 0 ? ` · ${i.days_overdue}d overdue` : ""}</span></div>
        <div className="d-kv"><span>Ageing</span><span>{i.bucket}</span></div>
      </div>
      {!settled ? (
        <form className="panel-body" onSubmit={recordPayment}>
          {payNote ? <div className="note bad">{payNote}</div> : null}
          <div className="row">
            <div className="field"><label htmlFor="pAmt">Amount</label><input id="pAmt" type="number" step="0.01" min="0" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
            <div className="field"><label htmlFor="pDate">Received on</label><input id="pDate" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="pMethod">Method</label>
              <select id="pMethod" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option>Bank transfer</option><option>Cash</option><option>Mobile money</option><option>Cheque</option>
              </select>
            </div>
            <div className="field"><label htmlFor="pRef">Reference</label><input id="pRef" type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>
          </div>
          <button className="primary settle" type="submit" disabled={paying}>{paying ? "Recording…" : "Record payment"}</button>
        </form>
      ) : null}
    </>
  );
}

function PrintSheet({ detail, onDone }: { detail: InvoiceDetail; onDone: () => void }) {
  useEffect(() => {
    const handler = () => onDone();
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, [onDone]);

  const { invoice: inv, lines, payments } = detail;
  const rec = payments.reduce((s, p) => s + Number(p.amount), 0);
  const c = inv.customers;

  return createPortal(
    <div id="sheet">
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">Invoice</div>
          {inv.invoice_no}<br />Issued {inv.issued_on}<br />Due {inv.due_on}
        </div>
      </div>
      <div className="parties">
        <div>
          <h4>Invoice to</h4>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{c?.name || ""}</div>
          <div style={{ fontSize: 11.5, color: "#444" }}>
            {c?.country || ""}
            {c?.tpin ? <>{" "}<br />TPIN {c.tpin}</> : null}
            {c?.contact_email ? <><br />{c.contact_email}</> : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <h4>Stage</h4>
          <div style={{ fontSize: 13 }}>{lab(inv.invoice_type)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, idx) => (
            <tr key={idx}>
              <td>{l.description}</td>
              <td className="num">{Number(l.quantity)}</td>
              <td className="num">{m2(l.unit_price, inv.currency)}</td>
              <td className="num">{m2(l.line_total, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div><span>Subtotal</span><span>{m2(inv.subtotal, inv.currency)}</span></div>
        {rec > 0 ? <div><span>Received to date</span><span>− {m2(rec, inv.currency)}</span></div> : null}
        <div className="due"><span>Amount due</span><span>{m2(Number(inv.total_due) - rec, inv.currency)}</span></div>
      </div>
      <div className="terms">
        <b>Payment terms</b><br />{c?.payment_terms || "50% on loading, 50% on delivery. USD only."}<br /><br />
        <b>Remit to</b><br />{COMPANY.bank.map((line, idx) => <span key={idx}>{line}<br /></span>)}
      </div>
    </div>,
    document.body,
  );
}
