// Line icons for the sidebar: one 24px grid, 1.8px strokes, round ends,
// drawn in the text colour so they follow the active/hover states.

const PATHS = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  board: "M2.5 6.5h11v9h-11zM13.5 9.5h4.2l3 3.4v2.6h-7.2zM6 18.5a1.8 1.8 0 1 0 0-.01M17 18.5a1.8 1.8 0 1 0 0-.01",
  docket: "M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9 8h6M9 12h6M9 16h3",
  estimator: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 6.5h8v3H8zM8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01",
  billing: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5M10 8.5h2",
  cashbook: "M3.5 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 7.5l11-3.5v3.5M15.5 13.5h2",
  reports: "M4 20h16M7 20v-6M12 20V6M17 20v-9",
  admin: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  organizations: "M4 21V5l8-2v18M12 8l8 2.5V21M3 21h18M7.5 8h1M7.5 12h1M7.5 16h1M15.5 13h1M15.5 17h1",
  inbox: "M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3.5 13.5h5l1.5 2.5h4l1.5-2.5h5",
  signout: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h9",
  collapse: "M15 6l-6 6 6 6M20 5v14",
  expand: "M9 6l6 6-6 6M4 5v14",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
} as const;

export type IconName = keyof typeof PATHS;

export function NavIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="nav-icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
