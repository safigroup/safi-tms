import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
import s from "./AuthShell.module.css";

const CORRIDOR = [
  { name: "Dar es Salaam", note: "TZ · loading" },
  { name: "Tunduma / Nakonde", note: "TZ ⇄ ZM border" },
  { name: "Kasumbalesa", note: "ZM ⇄ CD border" },
  { name: "Lubumbashi", note: "CD · delivered" },
];

// Shared frame for every public auth page -- sign in, forgot password, and
// the token-verified set-password pages -- so each one links back to the
// landing page and they all look the same. Only chrome lives here; each
// page keeps its own form logic.
export function AuthShell({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className={s.shell}>
      <aside className={s.brandPanel}>
        <Link href="/" className={s.brand}>
          <span className={s.brandName}>Safi TMS</span>
          <span className={s.brandSub}>Transport management</span>
        </Link>
        <div className={s.brandBody}>
          <p className={s.brandLine}>Run the corridor, not the spreadsheet.</p>
          <ol className={s.route} aria-hidden="true">
            {CORRIDOR.map((stop) => (
              <li key={stop.name} className={s.stop}>
                <span className={s.stopName}>{stop.name}</span>
                <span className={s.stopNote}>{stop.note}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className={s.brandFoot}>Trips, costs, billing and truck profit in one place.</p>
      </aside>

      <main className={s.formSide}>
        <div className={s.formTop}>
          <Link href="/" className={s.back}>
            <span aria-hidden="true">←</span> Back to home
          </Link>
          <span className="who"><ThemeToggle /></span>
        </div>
        <div className={s.formWrap}>
          <p className={s.kicker}>{kicker}</p>
          <h1 className={s.title}>{title}</h1>
          {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}
          <div className={s.body}>{children}</div>
        </div>
      </main>
    </div>
  );
}
