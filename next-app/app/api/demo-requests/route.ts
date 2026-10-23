import { NextResponse } from "next/server";
import { createDemoRequest } from "@/lib/demoRequests/createDemoRequest";
import { DEMO_COUNTRIES, DEMO_FLEET_SIZES } from "@/lib/demoRequests/options";

const COUNTRY_CODES = new Set<string>(DEMO_COUNTRIES.map((c) => c.code));
const FLEET_CODES = new Set<string>(DEMO_FLEET_SIZES.map((f) => f.code));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

// Public and unauthenticated -- the landing page's demo request form.
// Errors are short codes rather than sentences so the form can show them
// in whichever language the visitor is reading.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Honeypot: a field people never see. Answered exactly like a real
  // submission so a bot gets no signal to adapt to.
  if (text(body.website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const name = text(body.name, 120);
  const company = text(body.company, 160);
  const email = text(body.email, 254);
  const phone = text(body.phone, 40);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!company) return NextResponse.json({ error: "company_required" }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ error: "contact_required" }, { status: 400 });
  if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (phone && phone.replace(/\D/g, "").length < 7) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const country = text(body.country, 10);
  const fleetSize = text(body.fleetSize, 10);
  const result = await createDemoRequest(
    {
      name,
      company,
      email,
      phone,
      country: country && COUNTRY_CODES.has(country) ? country : null,
      fleetSize: fleetSize && FLEET_CODES.has(fleetSize) ? fleetSize : null,
      message: text(body.message, 2000),
      lang: body.lang === "fr" ? "fr" : "en",
    },
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown",
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "rate_limited" ? 429 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
