"use client";

import { useLayoutEffect, useState } from "react";

const STORAGE_KEY = "safi:theme";

// The root layout's inline script already sets data-theme before first
// paint, but React's Strict Mode remounts the tree once in development
// and resets <html> to only the attributes JSX manages, clearing what the
// script set. useLayoutEffect re-applies it before the browser paints
// (a no-op in production) and syncs this component's own state to match.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing this component's label to the theme already applied to <html> above, not deriving new state
    setTheme(stored);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
