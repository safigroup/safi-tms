import "server-only";
import type { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Reading helpers shared by the report routes.

export type Admin = Extract<Awaited<ReturnType<typeof getAuthedOrgContext>>, { ok: true }>["admin"];

const PAGE = 1000;

type Paged<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Every row of a query, a page at a time: the API returns at most 1000
// rows a request, and a long-lived truck or a whole fleet can pass that.
// The query must be ordered by something unique, or a row can be skipped
// or repeated between pages.
export async function allRows<T>(page: (lo: number, hi: number) => Paged<T>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

// Ids a hundred at a time, so an `in` filter never outgrows a request.
export function chunks<T>(ids: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
