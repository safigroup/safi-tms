"use client";

import { createContext, Fragment, useContext, type ReactNode } from "react";
import { letterheadLines, type CompanyDetails } from "@/lib/company";

// The signed-in company's letterhead details for every page below
// app/(app)/layout.tsx -- print sheets are portalled into <body>, and
// context still reaches them. Admin -> Company refreshes the layout after
// a save, so the next printout carries the new details.
const Company = createContext<CompanyDetails>({
  name: "",
  registration_no: null,
  tax_id: null,
  address: null,
  contact_phone: null,
  contact_email: null,
  bank_details: null,
});

export function CompanyProvider({ company, children }: { company: CompanyDetails; children: ReactNode }) {
  return <Company.Provider value={company}>{children}</Company.Provider>;
}

export const useCompany = () => useContext(Company);

// The left half of a printed document's header: the company's name and its
// details underneath. The same on every printout.
export function Letterhead({ company }: { company?: CompanyDetails }) {
  const fromContext = useCompany();
  const c = company ?? fromContext;
  const lines = letterheadLines(c);
  return (
    <div className="co">
      <h1>{c.name}</h1>
      {lines.length ? (
        <p>
          {lines.map((line, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              {line}
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}
