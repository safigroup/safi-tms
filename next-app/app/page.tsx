import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Landing } from "./_landing/Landing";
import { COPY, LANG_COOKIE, type Lang } from "./_landing/copy";

// The visitor's own choice wins; otherwise French-first browsers (the
// DRC market) get French straight away, everyone else English.
async function resolveLang(): Promise<Lang> {
  const stored = (await cookies()).get(LANG_COOKIE)?.value;
  if (stored === "en" || stored === "fr") return stored;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

export async function generateMetadata(): Promise<Metadata> {
  return COPY[await resolveLang()].meta;
}

// Public landing page for signed-out visitors. Signed-in users never see
// it -- "/" has always been their way into the app, so it still sends
// them straight to the Board.
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/board");

  return <Landing initialLang={await resolveLang()} year={new Date().getFullYear()} />;
}
