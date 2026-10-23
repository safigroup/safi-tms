"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { DEMO_COUNTRIES, DEMO_FLEET_SIZES } from "@/lib/demoRequests/options";
import type { Lang, LandingCopy } from "./copy";
import s from "./landing.module.css";

type FormCopy = LandingCopy["demo"]["form"];
type ErrorCode = keyof FormCopy["errors"];

const EMPTY = { name: "", company: "", email: "", phone: "", country: "", fleetSize: "", message: "", website: "" };

export function DemoRequestForm({ lang, c }: { lang: Lang; c: FormCopy }) {
  const [fields, setFields] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  const bind = (key: keyof typeof EMPTY) => ({
    value: fields[key],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value })),
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const res = await fetch("/api/demo-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, lang }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) {
      setSent(true);
      return;
    }
    const body = res ? await res.json().catch(() => ({})) : {};
    setError(body.error in c.errors ? body.error : "failed");
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className={s.panelTitle}>{c.title}</h3>
      </div>
      {sent ? (
        <div className="panel-body">
          <div className="note good" role="status" style={{ marginBottom: 0 }}>{c.sent}</div>
        </div>
      ) : (
        <form className="panel-body" onSubmit={handleSubmit} noValidate>
          {error ? <div className="note bad" role="alert">{c.errors[error]}</div> : null}
          <div className="row">
            <div className="field">
              <label htmlFor="drName">{c.name}</label>
              <input id="drName" type="text" autoComplete="name" maxLength={120} {...bind("name")} />
            </div>
            <div className="field">
              <label htmlFor="drCompany">{c.company}</label>
              <input id="drCompany" type="text" autoComplete="organization" maxLength={160} {...bind("company")} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="drEmail">{c.email}</label>
              <input id="drEmail" type="email" autoComplete="email" maxLength={254} {...bind("email")} />
            </div>
            <div className="field">
              <label htmlFor="drPhone">{c.phone}</label>
              <input id="drPhone" type="tel" autoComplete="tel" maxLength={40} {...bind("phone")} />
            </div>
          </div>
          <div className="field" style={{ marginTop: -6 }}>
            <div className="hint">{c.contactHint}</div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="drCountry">{c.country}</label>
              <select id="drCountry" {...bind("country")}>
                <option value="">{c.choose}</option>
                {DEMO_COUNTRIES.map((o) => <option key={o.code} value={o.code}>{o[lang]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="drFleet">{c.fleetSize}</label>
              <select id="drFleet" {...bind("fleetSize")}>
                <option value="">{c.choose}</option>
                {DEMO_FLEET_SIZES.map((o) => <option key={o.code} value={o.code}>{o[lang]}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="drMessage">{c.message}</label>
            <textarea id="drMessage" className={s.textarea} maxLength={2000} {...bind("message")} />
          </div>
          <div className={s.hp} aria-hidden="true">
            <label htmlFor="drWebsite">Website</label>
            <input id="drWebsite" type="text" tabIndex={-1} autoComplete="off" {...bind("website")} />
          </div>
          <button className="primary" type="submit" disabled={sending}>
            {sending ? c.sending : c.submit}
          </button>
        </form>
      )}
    </div>
  );
}
