import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The card shown when someone shares a safitms.com link on WhatsApp,
// LinkedIn, email and the like. Built once at build time; the fonts are
// static Manrope files in assets/fonts (the generator can't read the
// woff2 files next/font serves).

export const alt = "Safi TMS: know every trip's profit before the truck comes home";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#F5F2EA";
const SOFT = "rgba(245, 242, 234, 0.74)";
const RULE = "rgba(245, 242, 234, 0.28)";
const ACCENT = "#4CD39A";
const AMBER = "#E0A83E";

const STOPS = [
  { name: "Dar es Salaam", note: "Loaded 9 Nov", border: false, state: "done" },
  { name: "Tunduma", note: "19h wait", border: true, state: "done" },
  { name: "Kasumbalesa", note: "Waiting 31h", border: true, state: "here" },
  { name: "Lubumbashi", note: "", border: false, state: "ahead" },
] as const;

export default async function Image() {
  const [bold, medium] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Manrope-700.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Manrope-500.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px 56px",
          color: INK,
          fontFamily: "Manrope",
          background: "radial-gradient(circle at 82% 12%, #2B4F7A 0%, #16304F 42%, #0F213A 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontSize: 34, fontWeight: 700 }}>Safi TMS</span>
          <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: 3, color: SOFT }}>TRANSPORT MANAGEMENT</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", fontSize: 70, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2, maxWidth: 980 }}>
          <span>Know every trip&apos;s&nbsp;</span>
          <span style={{ color: ACCENT }}>profit&nbsp;</span>
          <span>before the truck comes home.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "flex", position: "relative", height: 92 }}>
            <div style={{ position: "absolute", left: 10, right: 10, top: 11, height: 3, background: RULE }} />
            <div style={{ position: "absolute", left: 10, top: 11, width: "64%", height: 3, background: INK }} />
            {STOPS.map((s, i) => {
              const left = `${(i / (STOPS.length - 1)) * 100}%`;
              const align = i === 0 ? "flex-start" : i === STOPS.length - 1 ? "flex-end" : "center";
              const shift = i === 0 ? "0" : i === STOPS.length - 1 ? "-100%" : "-50%";
              const color = s.state === "here" ? AMBER : s.state === "done" ? INK : "transparent";
              return (
                <div
                  key={s.name}
                  style={{
                    position: "absolute",
                    left,
                    top: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: align,
                    gap: 8,
                    transform: `translateX(${shift})`,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: s.border ? 4 : 12,
                      ...(s.border ? { transform: "rotate(45deg) scale(0.85)" } : {}),
                      border: `3px solid ${s.state === "ahead" ? RULE : color}`,
                      background: color === "transparent" ? "#16304F" : color,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: 2 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: s.state === "ahead" ? SOFT : INK }}>{s.name}</span>
                    {s.note ? (
                      <span style={{ fontSize: 17, fontWeight: 500, color: s.state === "here" ? AMBER : SOFT }}>{s.note}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 500, color: SOFT }}>
            <span>Trips · costs in local currency · billing · profit per truck</span>
            <span style={{ color: INK, fontWeight: 700 }}>safitms.com · EN / FR</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Manrope", data: bold, style: "normal", weight: 700 },
        { name: "Manrope", data: medium, style: "normal", weight: 500 },
      ],
    },
  );
}
