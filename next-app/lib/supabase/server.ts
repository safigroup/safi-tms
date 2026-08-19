import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Request-scoped SSR client, anon key only, bound to the current request's
// cookies. Used to resolve "who is making this request" (auth.getUser()) —
// never for data access, which goes through the service-role client in
// lib/supabase/admin.ts, obtained only via lib/auth/getAuthedOrgContext.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render, where cookies can't be
            // set. Harmless as long as proxy.ts is refreshing the session on
            // every request — see that file for why this fallback is safe.
          }
        },
      },
    },
  );
}
