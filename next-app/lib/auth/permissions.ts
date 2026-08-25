import "server-only";
import type { OrgRole } from "./getAuthedOrgContext";

// The permission matrix, in one place. Every mutating route checks one of
// these sets right after its getAuthedOrgContext() call -- see
// admin/users/[id]/reset-password/route.ts for the shape every other route
// follows.
export const CAN_MANAGE_TRIPS: ReadonlySet<OrgRole> = new Set(["owner", "admin", "ops"]);
export const CAN_MANAGE_BILLING: ReadonlySet<OrgRole> = new Set(["owner", "admin", "finance"]);
export const CAN_EDIT_FLEET: ReadonlySet<OrgRole> = new Set(["owner", "admin", "ops"]);
export const CAN_EDIT_COMMERCIAL: ReadonlySet<OrgRole> = new Set(["owner", "admin", "finance"]);
export const CAN_MANAGE_TEAM: ReadonlySet<OrgRole> = new Set(["owner", "admin"]);
