"use client";

import { useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
import { COPY, LANG_COOKIE, type Lang } from "./copy";
import { DemoRequestForm } from "./DemoRequestForm";
import s from "./landing.module.css";

function rememberLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  document.title = COPY[lang].meta.title;
}

export function Landing({ initialLang, year }: { initialLang: Lang; year: number }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const c = COPY[lang];

  function chooseLang(next: Lang) {
    setLang(next);
    rememberLang(next);
  }

  return (
    <div className={s.page} lang={lang}>
      <header className={s.top}>
        <div className={`${s.container} ${s.topRow}`}>
          <Link href="/" className={s.brand}>
            <span className={s.brandName}>Safi TMS</span>
            <span className={s.brandSub}>{c.header.tagline}</span>
          </Link>
          <div className={s.tools}>
            <div className={s.langGroup} role="group" aria-label={c.header.language}>
              {(["en", "fr"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={"chip" + (lang === l ? " on" : "")}
                  aria-pressed={lang === l}
                  onClick={() => chooseLang(l)}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="who"><ThemeToggle /></span>
            <Link href="/login" className={s.signIn}>{c.header.signIn}</Link>
            <a href="#demo" className={`${s.btn} ${s.btnPrimary} ${s.btnSm} ${s.topCta}`}>{c.header.requestDemo}</a>
          </div>
        </div>
      </header>

      <main>
        <section className={`${s.container} ${s.hero}`}>
          <div className={s.heroGrid}>
            <div>
              <p className={s.kicker}>{c.hero.eyebrow}</p>
              <h1 className={s.h1}>
                {c.hero.titleLead}<span className={s.accent}>{c.hero.titleAccent}</span>{c.hero.titleTail}
              </h1>
              <p className={s.lede}>{c.hero.lede}</p>
              <div className={s.ctaRow}>
                <a href="#demo" className={`${s.btn} ${s.btnPrimary}`}>{c.hero.primary}</a>
                <Link href="/login" className={`${s.btn} ${s.btnSecondary}`}>{c.hero.secondary}</Link>
              </div>
              <p className={s.credibility}>{c.hero.credibility}</p>
            </div>
            <BoardPreview caption={c.hero.mockCaption} />
          </div>
        </section>

        <section className={s.section}>
          <div className={s.container}>
            <p className={s.kicker}>{c.points.kicker}</p>
            <h2 className={s.h2}>{c.points.title}</h2>
            <ul className={s.points}>
              {c.points.items.map((p, i) => (
                <li key={p.title} className={s.point}>
                  <span className={s.pointNo}>{String(i + 1).padStart(2, "0")}</span>
                  <h3 className={s.h3}>{p.title}</h3>
                  <p className={s.body}>{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${s.section} ${s.sectionAlt}`}>
          <div className={s.container}>
            <p className={s.kicker}>{c.flow.kicker}</p>
            <h2 className={s.h2}>{c.flow.title}</h2>
            <p className={s.sectionLede}>{c.flow.lede}</p>
            <ol className={s.flow}>
              {c.flow.steps.map((st, i) => (
                <li key={st.module} className={s.step}>
                  <span className={s.stepNo}>{String(i + 1).padStart(2, "0")}</span>
                  <h3 className={`${s.h3} ${s.stepTitle}`}>{st.label}</h3>
                  <div className={s.stepModule}><span className="pill violet">{st.module}</span></div>
                  <p className={`${s.body} ${s.stepBody}`}>{st.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.container}>
            <p className={s.kicker}>{c.trust.kicker}</p>
            <h2 className={s.h2}>{c.trust.title}</h2>
            <ul className={s.trust}>
              {c.trust.items.map((t) => (
                <li key={t.title} className={s.trustItem}>
                  <h3 className={s.h3}>{t.title}</h3>
                  <p className={s.body}>{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="demo" className={`${s.section} ${s.sectionAlt} ${s.demoSection}`}>
          <div className={`${s.container} ${s.demoGrid}`}>
            <div>
              <p className={s.kicker}>{c.demo.kicker}</p>
              <h2 className={s.h2}>{c.demo.title}</h2>
              <p className={s.sectionLede}>{c.demo.lede}</p>
              <ol className={s.next}>
                {c.demo.next.map((n) => <li key={n}>{n}</li>)}
              </ol>
            </div>
            <DemoRequestForm lang={lang} c={c.demo.form} />
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={`${s.container} ${s.footerRow}`}>
          <span className={s.brand}>
            <span className={s.brandName}>Safi TMS</span>
            <span className={s.footerMeta}>{c.footer.tagline}</span>
          </span>
          <span className={s.footerMeta}>
            <Link href="/login" className={s.signIn}>{c.footer.signIn}</Link>
            {" · "}© {year}
          </span>
        </div>
      </footer>
    </div>
  );
}

// A static picture of the real Board, built from the app's own component
// classes so it can't drift from what users actually see. Deliberately
// English in both languages -- the signed-in screens are English-only, so
// a French preview would promise an interface that doesn't exist.
function BoardPreview({ caption }: { caption: string }) {
  return (
    <figure className={s.mock}>
      <div className={s.mockFrame} aria-hidden="true">
        <div className={s.mockBar}>
          <span className={s.mockBrand}>Safi TMS</span>
          <span className={s.mockTabs}>
            <span className={`${s.mockTab} ${s.mockTabOn}`}>Board</span>
            <span className={s.mockTab}>Cost docket</span>
            <span className={s.mockTab}>Billing</span>
            <span className={s.mockTab}>Reports</span>
            <span className={s.mockTab}>Estimator</span>
          </span>
        </div>
        <div className={`strip ${s.mockStrip}`}>
          <div className="cell">
            <div className="k">On the road</div>
            <div className="v">7</div>
            <div className="n">11 open trips</div>
          </div>
          <div className="cell">
            <div className="k">Over corridor target</div>
            <div className="v warn">1</div>
            <div className="n">T-1039</div>
          </div>
          <div className="cell">
            <div className="k">Awaiting POD</div>
            <div className="v warn">1</div>
            <div className="n">USD 5,104 not yet billable</div>
          </div>
          <div className="cell">
            <div className="k">Avg margin, delivered</div>
            <div className="v pos">18.6%</div>
            <div className="n">24 trips</div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <span className={s.panelTitle}>Trips</span>
          </div>
          <ul className="list">
            <li className="sel">
              <div>
                <div className="r-no">T-1042</div>
                <div className="r-title">Dar es Salaam → Kasumbalesa</div>
                <div className="r-sub">Truck 14 · 34 t</div>
                <div className="r-tags">
                  <span className="pill warn">at border</span>
                  <span className="pill grey">day 6</span>
                  <span className="pill violet">Tunduma / Nakonde</span>
                </div>
              </div>
              <div className="r-right">
                <div className="r-amt pos">USD 2,140</div>
                <div className="r-min">21.4%</div>
                <div className="r-min">9 costs</div>
              </div>
            </li>
            <li>
              <div>
                <div className="r-no">T-1039</div>
                <div className="r-title">Dar es Salaam → Goma</div>
                <div className="r-sub">Truck 08 · 30 t</div>
                <div className="r-tags">
                  <span className="pill violet">in transit</span>
                  <span className="pill bad">day 5 of 4</span>
                  <span className="pill violet">Rusumo</span>
                </div>
              </div>
              <div className="r-right">
                <div className="r-amt pos">USD 1,385</div>
                <div className="r-min">17.9%</div>
                <div className="r-min">6 costs</div>
              </div>
            </li>
          </ul>
        </div>
        <div className={`stamp live ${s.mockStamp}`}>
          <span className="native">TZS 1,250,000.00</span>
          <span className="arrow">→</span>
          <span className="usd">USD 473.79</span>
          <span className="rate">Rate on file <b>1 TZS = 0.00037903 USD</b> · frozen onto this entry</span>
        </div>
      </div>
      <figcaption className={s.mockCaption}>{caption}</figcaption>
    </figure>
  );
}
