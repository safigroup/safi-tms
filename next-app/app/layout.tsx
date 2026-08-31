import type { Metadata } from "next";
import { Manrope, IBM_Plex_Mono, Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Manrope for headings/brand/labels (--cond), Inter for body/UI text
// (--font-sans) -- a more modern, professional pairing than the previous
// Archivo Narrow (condensed, all-caps) + IBM Plex Sans combination.
// IBM Plex Mono stays for numeric/financial data -- already distinctive
// and legible, no reason to change it.
const manrope = Manrope({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-cond",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-mono",
});

const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Safi TMS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${ibmPlexMono.variable} ${inter.variable}`}
    >
      <body>
        {children}
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
