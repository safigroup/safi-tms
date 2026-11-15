"use client";

import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
import { COPY, LANG_COOKIE, WHATSAPP, type Lang } from "./copy";
import { DemoRequestForm } from "./DemoRequestForm";
import { BillingPreview, BorderPreview, DispatchPreview, LiveTrip, OverviewPreview, ReviewPreview, RoadPreview } from "./previews";
import s from "./landing.module.css";

const STEP_PREVIEWS: Record<string, ComponentType> = {
  dispatch: DispatchPreview,
  road: RoadPreview,
  border: BorderPreview,
  billing: BillingPreview,
  review: ReviewPreview,
};

function rememberLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  document.title = COPY[lang].meta.title;
}

// A chat opened on that number with the greeting already typed.
const waLink = (wa: string, greeting: string) => `https://wa.me/${wa}?text=${encodeURIComponent(greeting)}`;

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className={s.waIcon}>
      <path d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.2 20.8l4.5-1.2A8.8 8.8 0 1 0 12 3.2Z" />
      <path d="M9.1 8.2c.3 0 .5 0 .6.4l.8 1.9c.1.2 0 .4-.1.6l-.6.7c-.1.1-.1.3 0 .5a6.4 6.4 0 0 0 3 2.6c.2.1.4 0 .5-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.2.1.3.3.3.5 0 1-.8 1.9-1.9 2A7.6 7.6 0 0 1 7.4 10c.1-1 .9-1.8 1.7-1.8Z" className={s.waHandset} />
    </svg>
  );
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Blocks marked data-reveal fade in as they scroll into view. Anything
// already on screen when the page loads is shown at once, and with reduced
// motion nothing is hidden at all. Only wrappers whose React keys never
// change carry data-reveal, so switching language can't re-create (and
// re-hide) one that has already been revealed.
function useReveal(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = root.current;
    if (!page || reducedMotion()) return;
    const items = [...page.querySelectorAll<HTMLElement>("[data-reveal]")];
    for (const el of items) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "";
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of items) if (!("in" in el.dataset)) io.observe(el);
    page.setAttribute("data-armed", "");
    return () => io.disconnect();
  }, [root]);
}

// The phone-width "Request a demo" bar: shown once the hero's buttons have
// scrolled away, hidden again while the form itself is on screen.
function useStickyCta(heroCta: RefObject<HTMLDivElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const hero = heroCta.current;
    const demo = document.getElementById("demo");
    if (!hero || !demo) return;
    let pastHero = false;
    let atDemo = false;
    const update = () => setOn(pastHero && !atDemo);
    const heroIo = new IntersectionObserver(([e]) => {
      pastHero = !e.isIntersecting && e.boundingClientRect.top < 0;
      update();
    });
    const demoIo = new IntersectionObserver(([e]) => {
      atDemo = e.isIntersecting;
      update();
    }, { threshold: 0.1 });
    heroIo.observe(hero);
    demoIo.observe(demo);
    return () => {
      heroIo.disconnect();
      demoIo.disconnect();
    };
  }, [heroCta]);
  return on;
}

export function Landing({ initialLang, year }: { initialLang: Lang; year: number }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const c = COPY[lang];
  const pageRef = useRef<HTMLDivElement>(null);
  const heroCtaRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef);
  const stickyOn = useStickyCta(heroCtaRef);

  function chooseLang(next: Lang) {
    setLang(next);
    rememberLang(next);
  }

  return (
    <div className={s.page} lang={lang} ref={pageRef}>
      <header className={s.top}>
        <div className={`${s.container} ${s.topRow}`}>
          <Link href="/" className={s.brand}>
            <span className={s.brandName}>Safi TMS</span>
            <span className={s.brandSub}>{c.header.tagline}</span>
          </Link>
          <nav className={s.nav}>
            <a href="#how">{c.header.navHow}</a>
            <a href="#faq">{c.header.navFaq}</a>
          </nav>
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
        <section className={s.hero}>
          <svg className={s.heroRoad} viewBox="0 0 1440 640" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-40 560 C 260 520, 380 380, 640 360 S 1060 300, 1180 150 S 1400 40, 1500 20" />
          </svg>
          <div className={`${s.container} ${s.heroGrid}`}>
            <div className={s.heroText}>
              <p className={s.eyebrow}>{c.hero.eyebrow}</p>
              <h1 className={s.h1}>
                {c.hero.titleLead}<span className={s.accent}>{c.hero.titleAccent}</span>{c.hero.titleTail}
              </h1>
              <p className={s.lede}>{c.hero.lede}</p>
              <div className={s.ctaRow} ref={heroCtaRef}>
                <a href="#demo" className={`${s.btn} ${s.btnHero}`}>
                  {c.hero.primary} <span aria-hidden="true">→</span>
                </a>
                <a href="#how" className={`${s.btn} ${s.btnHeroGhost}`}>{c.hero.secondary}</a>
              </div>
              <p className={s.reassure}>{c.hero.reassurance}</p>
              <p className={s.heroWa}>
                <span>{c.whatsapp.hero}</span>
                {WHATSAPP.map((n, i) => (
                  <span key={n.wa}>
                    {i ? <span aria-hidden="true"> · </span> : null}
                    <a href={waLink(n.wa, c.whatsapp.greeting)} target="_blank" rel="noopener noreferrer" title={n.display}>
                      {n.country[lang]}
                    </a>
                  </span>
                ))}
              </p>
              <p className={s.credibility}>{c.hero.credibility}</p>
            </div>
            <LiveTrip caption={c.hero.liveCaption} />
          </div>
          <div className={s.container}>
            <ul className={s.facts}>
              {c.facts.map((f, i) => (
                <li key={i} className={s.fact}>
                  <span className={s.factV}>{f.v}</span>
                  <span className={s.factK}>{f.k}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.container}>
            <div data-reveal>
              <p className={s.kicker}>{c.pains.kicker}</p>
              <h2 className={s.h2}>{c.pains.title}</h2>
            </div>
            <div className={s.pains} data-reveal>
              <div className={s.painHead} aria-hidden="true">
                <span>{c.pains.before}</span>
                <span>{c.pains.after}</span>
              </div>
              <ul className={s.painList}>
                {c.pains.rows.map((r, i) => (
                  <li key={i} className={s.painRow}>
                    <p className={s.painBefore}><span className={s.srOnly}>{c.pains.before}: </span>{r.before}</p>
                    <p className={s.painAfter}><span className={s.srOnly}>{c.pains.after}: </span>{r.after}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`${s.section} ${s.sectionAlt}`}>
          <div className={`${s.container} ${s.show} ${s.showWide}`}>
            <div className={s.showText} data-reveal>
              <p className={s.stepTag}>
                <span className={s.kicker}>{c.overview.kicker}</span>
                <span className="pill violet">{c.overview.module}</span>
              </p>
              <h2 className={s.h2}>{c.overview.title}</h2>
              <p className={s.showBody}>{c.overview.body}</p>
              <ul className={s.ticks}>
                {c.overview.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
            <figure className={s.showFig} data-reveal>
              <OverviewPreview />
              <figcaption className={s.figcap}>{c.overview.caption}</figcaption>
            </figure>
          </div>
        </section>

        <section id="how" className={`${s.section} ${s.anchor}`}>
          <div className={s.container}>
            <div className={s.flowHead} data-reveal>
              <p className={s.kicker}>{c.flow.kicker}</p>
              <h2 className={s.h2}>{c.flow.title}</h2>
              <p className={s.sectionLede}>{c.flow.lede}</p>
            </div>
            <ol className={s.stops} data-reveal>
              {c.flow.steps.map((st, i) => (
                <li key={st.id} className={s.stopItem}>
                  <a href={`#step-${st.id}`} className={s.stopLink}>
                    <span className={s.stopNo}>{String(i + 1).padStart(2, "0")}</span>
                    <span className={s.stopLabel}>{st.label}</span>
                  </a>
                </li>
              ))}
            </ol>
            <div className={s.steps}>
              {c.flow.steps.map((st, i) => {
                const Preview = STEP_PREVIEWS[st.id];
                return (
                  <article key={st.id} id={`step-${st.id}`} className={`${s.show} ${s.anchor} ${i % 2 ? s.flip : ""}`}>
                    <div className={s.showText} data-reveal>
                      <p className={s.stepTag}>
                        <span className={s.stepNo}>{String(i + 1).padStart(2, "0")}</span>
                        <span className={s.stepLabel}>{st.label}</span>
                        <span className="pill violet">{st.module}</span>
                      </p>
                      <h3 className={s.h3big}>{st.title}</h3>
                      <p className={s.showBody}>{st.body}</p>
                      <ul className={s.ticks}>
                        {st.bullets.map((b, j) => <li key={j}>{b}</li>)}
                      </ul>
                    </div>
                    <figure className={s.showFig} data-reveal>
                      <Preview />
                      <figcaption className={s.figcap}>{c.flow.caption}</figcaption>
                    </figure>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className={s.band}>
          <div className={`${s.container} ${s.bandRow}`} data-reveal>
            <p className={s.bandTitle}>{c.band.title}</p>
            <a href="#demo" className={`${s.btn} ${s.btnHero}`}>
              {c.band.cta} <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section className={`${s.section} ${s.sectionAlt}`}>
          <div className={s.container}>
            <div data-reveal>
              <p className={s.kicker}>{c.trust.kicker}</p>
              <h2 className={s.h2}>{c.trust.title}</h2>
            </div>
            <ul className={s.trust} data-reveal>
              {c.trust.items.map((t, i) => (
                <li key={i} className={s.trustItem}>
                  <h3 className={s.h3}>{t.title}</h3>
                  <p className={s.body}>{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className={`${s.section} ${s.anchor}`}>
          <div className={`${s.container} ${s.faqGrid}`}>
            <div data-reveal>
              <p className={s.kicker}>{c.faq.kicker}</p>
              <h2 className={s.h2}>{c.faq.title}</h2>
            </div>
            <div className={s.faq} data-reveal>
              {c.faq.items.map((f, i) => (
                <details key={i} className={s.qa} open={i === 0}>
                  <summary className={s.q}>{f.q}</summary>
                  <p className={s.a}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className={`${s.section} ${s.demoSection} ${s.anchor}`}>
          <div className={`${s.container} ${s.demoGrid}`}>
            <div>
              <p className={s.kicker}>{c.demo.kicker}</p>
              <h2 className={s.h2}>{c.demo.title}</h2>
              <p className={s.sectionLede}>{c.demo.lede}</p>
              <ol className={s.next}>
                {c.demo.next.map((n, i) => <li key={i}>{n}</li>)}
              </ol>
              <div className={s.wa}>
                <p className={s.waLead}>{c.whatsapp.lead}</p>
                <p className={s.waBody}>{c.whatsapp.body}</p>
                <div className={s.waRow}>
                  {WHATSAPP.map((n) => (
                    <a key={n.wa} className={s.waBtn} href={waLink(n.wa, c.whatsapp.greeting)} target="_blank" rel="noopener noreferrer">
                      <ChatIcon />
                      <span className={s.waText}>
                        <span className={s.waCountry}>{n.country[lang]}</span>
                        <span className={s.waNum}>{n.display}</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
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
            {c.whatsapp.footer}{" "}
            {WHATSAPP.map((n, i) => (
              <span key={n.wa}>
                {i ? " · " : null}
                <a href={waLink(n.wa, c.whatsapp.greeting)} target="_blank" rel="noopener noreferrer" className={s.footerLink}>{n.display}</a>
              </span>
            ))}
          </span>
          <span className={s.footerMeta}>
            <Link href="/login" className={s.signIn}>{c.footer.signIn}</Link>
            {" · "}© {year}
          </span>
        </div>
      </footer>

      <div className={`${s.sticky} ${stickyOn ? s.stickyOn : ""}`} aria-hidden={!stickyOn}>
        <span className={s.stickyNote}>{c.sticky.note}</span>
        <a href="#demo" className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`} tabIndex={stickyOn ? 0 : -1}>
          {c.sticky.cta}
        </a>
      </div>
    </div>
  );
}
