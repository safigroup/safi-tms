import { createBrowserClient } from "@supabase/ssr";

// Browser-side client, anon key only. This is for auth (sign in/out) alone —
// data access never happens from the browser in this app. Safe to expose:
// same key class as the publishable key the old index.html shipped with,
// and Supabase Auth's own security doesn't depend on RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
