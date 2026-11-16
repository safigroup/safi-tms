import type { CSSProperties, ReactNode } from "react";

// One figure in a page's band. With onClick it's a button (a filter or a
// shortcut, shown pressed while `on`); otherwise it's a plain read-out.
export type BandFig = {
  key: string;
  k: string;
  v: ReactNode;
  n?: ReactNode;
  tone?: "warn" | "bad" | "pos";
  on?: boolean;
  onClick?: () => void;
  title?: string;
};

// A tab along the band's bottom edge (Admin's sections, for one).
export type BandTab = { key: string; label: string; count?: number };

// The navy header every page opens with, after the landing page: a small
// kicker (the page's group), the page's headline, a line of context, its
// main actions on the right, and the page's key figures in a row below.
// `children` sits between the headline and the figures -- a picker or the
// page's filters.
export function PageBand({
  kicker,
  title,
  sub,
  actions,
  figs,
  figsWrap,
  tabs,
  tab,
  onTab,
  label,
  children,
}: {
  kicker: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  figs?: BandFig[];
  figsWrap?: boolean;
  tabs?: BandTab[];
  tab?: string;
  onTab?: (key: string) => void;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ops-band" aria-label={label ?? kicker}>
      <div className="ops-band-top">
        <div className="ops-head">
          <div className="ops-kicker">{kicker}</div>
          <h2 className="ops-title">{title}</h2>
          {sub ? <div className="ops-sub">{sub}</div> : null}
        </div>
        {actions ? <div className="ops-actions">{actions}</div> : null}
      </div>
      {children}
      {figs?.length ? (
        <div className={"ops-figs" + (figsWrap ? " fill" : figs.length > 4 ? " many" : "")} style={{ "--figs": figs.length } as CSSProperties}>
          {figs.map((f) => {
            const body = (
              <>
                <span className="k">{f.k}</span>
                <span className={"v" + (f.tone ? " " + f.tone : "")}>{f.v}</span>
                {f.n ? <span className="n">{f.n}</span> : null}
              </>
            );
            return f.onClick ? (
              <button
                key={f.key}
                type="button"
                className={"ops-fig" + (f.on ? " on" : "")}
                aria-pressed={f.on ?? false}
                title={f.title}
                onClick={f.onClick}
              >
                {body}
              </button>
            ) : (
              <div key={f.key} className="ops-fig" title={f.title}>{body}</div>
            );
          })}
        </div>
      ) : null}
      {tabs?.length ? (
        <div className="ops-tabs" role="tablist" aria-label={`${label ?? kicker} sections`}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === tab}
              className={"ops-tab" + (t.key === tab ? " on" : "")}
              onClick={() => onTab?.(t.key)}
            >
              {t.label}
              {t.count !== undefined ? <span className="ops-tab-n">{t.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
