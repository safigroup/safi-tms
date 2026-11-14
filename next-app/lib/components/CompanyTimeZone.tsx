"use client";

import { createContext, useContext, type ReactNode } from "react";

// The signed-in company's time zone (organizations.time_zone), for pages
// that need today's date or the calendar day something happened on:
// today(useCompanyTimeZone()). Set once by app/(app)/layout.tsx; the same
// value on the server render and in the browser, so dates never differ
// between the two.
const CompanyTimeZone = createContext("UTC");

export function CompanyTimeZoneProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  return <CompanyTimeZone.Provider value={timeZone}>{children}</CompanyTimeZone.Provider>;
}

export const useCompanyTimeZone = () => useContext(CompanyTimeZone);
