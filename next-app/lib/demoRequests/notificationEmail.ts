export type DemoRequestEmailInput = {
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  countryName: string | null;
  fleetLabel: string | null;
  message: string | null;
  lang: "en" | "fr";
  requestsUrl: string;
};

// Every value here came from a public form, so all of it is escaped before
// it goes anywhere near the HTML.
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const NAVY = "#1E3A5F";
const INK = "#1A1D23";
const SOFT = "#667085";
const RULE = "#E1DCD2";
const GROUND = "#F6F4EF";
const CARD = "#FCFAF6";

// The platform admins' notification for a new landing-page demo request.
// Table-based with inline styles, since that's what email clients render
// reliably; colors are the app's own light-theme tokens.
export function buildDemoRequestEmail(r: DemoRequestEmailInput) {
  const company = r.company.replace(/[\r\n]+/g, " ");
  const subject = `New demo request: ${company}`;
  const language = r.lang === "fr" ? "French — reply in French" : "English";

  const rows: [string, string | null, string | null][] = [
    ["Name", r.name, null],
    ["Email", r.email, r.email ? `mailto:${r.email}` : null],
    ["Phone / WhatsApp", r.phone, r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : null],
    ["Country", r.countryName, null],
    ["Fleet size", r.fleetLabel, null],
    ["Language", language, null],
  ];

  const text = [
    "New demo request from the Safi TMS landing page.",
    "",
    `Company: ${company}`,
    ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ...(r.message ? ["", "Message:", r.message] : []),
    "",
    `All demo requests: ${r.requestsUrl}`,
  ].join("\n");

  const rowHtml = rows
    .filter(([, v]) => v)
    .map(([k, v, href]) => {
      const value = href
        ? `<a href="${esc(href)}" style="color:${NAVY};text-decoration:none;">${esc(v!)}</a>`
        : esc(v!);
      return `<tr>
        <td style="padding:9px 0;border-bottom:1px solid ${RULE};font:500 11px/1.4 'IBM Plex Mono',Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};width:150px;vertical-align:top;">${esc(k)}</td>
        <td style="padding:9px 0;border-bottom:1px solid ${RULE};font:400 15px/1.5 Inter,Arial,sans-serif;color:${INK};">${value}</td>
      </tr>`;
    })
    .join("");

  const messageHtml = r.message
    ? `<p style="margin:24px 0 8px;font:500 11px/1.4 'IBM Plex Mono',Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};">Message</p>
       <div style="padding:14px 16px;background:${GROUND};border-left:3px solid ${NAVY};border-radius:6px;font:400 15px/1.6 Inter,Arial,sans-serif;color:${INK};">${esc(r.message).replace(/\n/g, "<br>")}</div>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${GROUND};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${CARD};border:1px solid ${RULE};border-radius:10px;overflow:hidden;">
    <tr><td style="padding:18px 24px;background:${NAVY};">
      <span style="font:700 18px/1.2 Manrope,Arial,sans-serif;color:#FFFFFF;">Safi TMS</span>
      <span style="font:500 11px/1.2 'IBM Plex Mono',Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.7);padding-left:10px;">New demo request</span>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0;font:500 11px/1.4 'IBM Plex Mono',Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:${NAVY};">From the landing page</p>
      <h1 style="margin:6px 0 18px;font:700 24px/1.2 Manrope,Arial,sans-serif;color:${INK};">${esc(company)}</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table>
      ${messageHtml}
      <p style="margin:28px 0 0;">
        <a href="${esc(r.requestsUrl)}" style="display:inline-block;padding:11px 18px;background:${NAVY};color:#FFFFFF;border-radius:8px;font:600 14px/1 Inter,Arial,sans-serif;text-decoration:none;">Open demo requests</a>
      </p>
    </td></tr>
    <tr><td style="padding:14px 24px;border-top:1px solid ${RULE};font:400 12px/1.5 Inter,Arial,sans-serif;color:${SOFT};">
      You're receiving this because you're a platform admin on Safi TMS.${r.email ? " Replying to this email goes straight to the requester." : ""}
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
