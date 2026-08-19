import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every request. Runs before
// Server Components render, so lib/supabase/server.ts always sees a fresh
// session — its own setAll() can't actually write cookies mid-render (see
// the comment there), this is what makes that safe.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touches the session so an expired access token gets refreshed here,
  // not discovered mid-render deep in a Server Component.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Skip static assets — a proxy running on every JS/CSS/image request
    // would just add latency for no reason.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
