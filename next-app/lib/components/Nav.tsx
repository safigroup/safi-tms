"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
import { NavIcon, type IconName } from "@/lib/components/NavIcons";
import { setActiveOrg } from "@/app/(app)/actions";
import type { BootstrapPayload, Organization } from "@/lib/types";
import { useCompanyTimeZone } from "@/lib/components/CompanyTimeZone";
import { dayIn } from "@/lib/format";
import { andList, fxStatus, shortDay } from "@/lib/fx/schedule";

// Mirrors CAN_USE_CASHBOOK (lib/auth/permissions.ts) -- the link is only
// a convenience; every /api/cashbook route enforces it.
const CASHBOOK_ROLES = ["owner", "admin", "finance"];

type View = { href: string; label: string; icon: IconName };
type Group = { label: string | null; views: View[] };

// The app's pages, grouped the way the office works: the day's picture,
// moving the trucks, the money, and settings.
const GROUPS: Group[] = [
  { label: null, views: [{ href: "/overview", label: "Overview", icon: "overview" }] },
  {
    label: "Operations",
    views: [
      { href: "/board", label: "Board", icon: "board" },
      { href: "/docket", label: "Cost docket", icon: "docket" },
      { href: "/estimates", label: "Estimator", icon: "estimator" },
    ],
  },
  {
    label: "Finance",
    views: [
      { href: "/billing", label: "Billing", icon: "billing" },
      { href: "/cashbook", label: "Cashbook", icon: "cashbook" },
      { href: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  { label: "Settings", views: [{ href: "/admin", label: "Admin", icon: "admin" }] },
];

const PLATFORM: Group = {
  label: "Platform",
  views: [
    { href: "/organizations", label: "Organizations", icon: "organizations" },
    { href: "/demo-requests", label: "Demo requests", icon: "inbox" },
  ],
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  ops: "Operations",
  finance: "Finance",
  viewer: "View only",
};

const RELOAD = "safi:nav-reload";

// Tells the sidebar to fetch its counts again (see the bootstrap effect).
export const reloadNav = () => window.dispatchEvent(new Event(RELOAD));

const NAV_KEY = "safi:nav";

// Two letters for the account's avatar, from the email's name part.
function initials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (letters || "?").toUpperCase();
}

// The app's sidebar: the company and its pages on the left, the account at
// the bottom. On wide screens it can be narrowed to a strip of icons (the
// choice is remembered, and the root layout's inline script applies it
// before first paint); between 900 and 1280px wide it's always that strip;
// on phones it slides in from a slim top bar. AppLayout stays a server
// component and just forwards the auth context plus the signOut action.
export function Nav({
  orgTitle,
  orgId,
  email,
  role,
  isPlatformAdmin,
  signOutAction,
}: {
  orgTitle: string;
  orgId: string;
  email: string;
  role: string;
  isPlatformAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const timeZone = useCompanyTimeZone();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/bootstrap")
        .then((res) => (res.ok ? res.json() : null))
        .then((payload: BootstrapPayload | null) => {
          setData(payload);
          setFetchedAt(Date.now());
        });
    load();
    // A page that changes what the badges and banner count (new exchange
    // rates) asks for a fresh look with reloadNav(); otherwise they'd stay
    // as they were until the next full page load.
    window.addEventListener(RELOAD, load);
    return () => window.removeEventListener(RELOAD, load);
  }, []);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/platform/organizations")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { organizations: Organization[] } | null) => setOrgs(body?.organizations ?? []));
  }, [isPlatformAdmin]);

  // The root layout's inline script applies the collapsed choice before
  // first paint; this re-applies it in case a development remount cleared
  // it (see ThemeToggle) and brings the button's label into line.
  useLayoutEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(NAV_KEY);
    } catch {
      // nothing remembered
    }
    if (saved) document.documentElement.setAttribute("data-nav", saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the toggle's label to the choice already applied above, not deriving new state
    setCollapsed(saved === "collapsed");
  }, []);

  // Closes the phone menu after a link click navigates (Link doesn't
  // remount Nav, so without this the menu would stay open on the new page).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the drawer is a reaction to navigation having already happened, not derived render state
    setMenuOpen(false);
  }, [pathname]);

  // While the phone menu is open: Escape closes it, the page behind doesn't
  // scroll, and focus starts inside it and returns to the menu button.
  useEffect(() => {
    if (!menuOpen) {
      if (wasOpen.current) menuButton.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  function toggleCollapsed() {
    const next = !collapsed;
    document.documentElement.setAttribute("data-nav", next ? "collapsed" : "expanded");
    try {
      localStorage.setItem(NAV_KEY, next ? "collapsed" : "expanded");
    } catch {
      // the choice just isn't remembered next time
    }
    setCollapsed(next);
  }

  async function switchOrg(id: string) {
    try {
      await setActiveOrg(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch organization");
      return;
    }
    // Full navigation, not router.push/refresh -- every client component
    // on the page (this one included) fetches its own data in a
    // mount-once effect, which a client-side transition wouldn't re-run.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: a router.push transition would leave stale client-fetched state (nav badges, bootstrap data) behind
    window.location.assign("/overview");
  }

  const groups = [
    ...GROUPS.map((g) => ({ ...g, views: g.views.filter((v) => v.href !== "/cashbook" || CASHBOOK_ROLES.includes(role)) })),
    ...(isPlatformAdmin ? [PLATFORM] : []),
  ];
  const isOn = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = groups.flatMap((g) => g.views).find((v) => isOn(v.href));

  // Exchange rates whose automatic update has been missed -- the same rule
  // as the status on Admin -> Exchange rates (lib/fx/schedule.ts), as of
  // when the data was fetched.
  const fx = fetchedAt ? fxStatus(data?.fx ?? [], dayIn(timeZone)(fetchedAt), fetchedAt) : null;
  const stale = fx?.late ?? [];

  const rolling = data?.board.filter((t) => ["loading", "in_transit", "at_border"].includes(t.status)).length ?? 0;
  const pod = data?.board.filter((t) => t.status === "delivered" && !t.pod_in_hand).length ?? 0;
  const overdue = data?.ar.filter((i) => i.days_overdue > 0).length ?? 0;
  const billing = (data?.billable.length ?? 0) + overdue;

  // [count, needs action]: trips on the road, POD to chase, things to bill,
  // exchange rates to update.
  const counts: Record<string, [number, boolean]> = {
    "/board": [rolling, false],
    "/docket": [pod, pod > 0],
    "/billing": [billing, overdue > 0],
    "/admin": [stale.length, stale.length > 0],
  };
  const anyAlert = Object.values(counts).some(([, alert]) => alert);

  return (
    <>
      <div className="topbar">
        <button
          ref={menuButton}
          type="button"
          className="topbar-btn"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen(true)}
        >
          <NavIcon name="menu" size={22} />
          {anyAlert ? <span className="topbar-dot" /> : null}
        </button>
        <span className="topbar-brand">{orgTitle || "Safi TMS"}</span>
        {current ? <span className="topbar-page">{current.label}</span> : null}
      </div>

      {menuOpen ? <div className="sb-backdrop" onClick={() => setMenuOpen(false)} /> : null}

      <aside id="app-sidebar" className={"sidebar" + (menuOpen ? " open" : "")}>
        <div className="sb-head">
          <Link href="/overview" className="sb-brand" title="Safi TMS">
            <span className="sb-mark" aria-hidden="true">S</span>
            <span className="lbl sb-word">Safi TMS</span>
          </Link>
          <button ref={closeButton} type="button" className="sb-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <NavIcon name="close" />
          </button>
        </div>

        <div className="sb-org">
          <h1 className="lbl sb-org-name">{orgTitle || "Safi TMS"}</h1>
          {isPlatformAdmin ? (
            <select
              className="lbl sb-org-switch"
              value={orgId}
              onChange={(e) => switchOrg(e.target.value)}
              aria-label="Viewing organization"
            >
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name.replace(/ Limited$/, "")}</option>)}
            </select>
          ) : null}
        </div>

        <nav className="sb-nav" aria-label="Main">
          {groups.map((g, gi) => (
            <div key={gi} className="sb-group">
              {g.label ? <div className="sb-group-label">{g.label}</div> : null}
              {g.views.map((v) => {
                const on = isOn(v.href);
                const [count, alert] = counts[v.href] ?? [0, false];
                return (
                  <Link
                    key={v.href}
                    href={v.href}
                    className={"sb-link" + (on ? " on" : "")}
                    aria-current={on ? "page" : undefined}
                    title={v.label}
                  >
                    <NavIcon name={v.icon} />
                    <span className="lbl">{v.label}</span>
                    {count > 0 ? <span className={"sb-count" + (alert ? " alert" : "")}>{count}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <div className="sb-user" title={`${email} · ${ROLE_LABEL[role] ?? role}`}>
            <span className="sb-avatar" aria-hidden="true">{initials(email)}</span>
            <span className="lbl sb-user-text">
              <span className="sb-email">{email}</span>
              <span className="sb-role">{ROLE_LABEL[role] ?? role}</span>
            </span>
          </div>
          <div className="sb-actions">
            <ThemeToggle />
            <form action={signOutAction}>
              <button type="submit" className="sb-btn" title="Sign out">
                <NavIcon name="signout" size={18} />
                <span className="lbl">Sign out</span>
              </button>
            </form>
            <button
              type="button"
              className="sb-btn sb-collapse"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
              title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            >
              <NavIcon name={collapsed ? "expand" : "collapse"} size={18} />
            </button>
          </div>
        </div>
      </aside>

      {stale.length && !isOn("/admin") ? (
        <div className="note warn">
          Exchange rates for {andList(stale.map((c) => c.currency))} are out of date: the automatic update was due on{" "}
          {shortDay(stale[0].dueOn, dayIn(timeZone)(fetchedAt!))} and hasn&apos;t come through. Every cost entered today converts
          at the old {stale.length === 1 ? "rate" : "rates"}. <Link href="/admin" style={{ color: "inherit" }}>Update them</Link>.
        </div>
      ) : null}
    </>
  );
}
