import type { Metadata } from "next";
import { Anton } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Anton (OFL) — a free, web-embeddable heavy-condensed display face that approximates the
// GTA/Pricedown poster look for headings. Self-hosted by next/font (no runtime external request).
const display = Anton({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Neighbor · AI Swap Terminal on Robinhood Chain",
  description: "Noncustodial AI swap terminal on Robinhood Chain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      {/* Browser wallet/theme extensions mutate <body> before React hydrates; suppress the resulting
          attribute-mismatch warning (it is environmental, not a server/client render divergence). */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
