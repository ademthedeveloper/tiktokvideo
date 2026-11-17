import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Chakra_Petch, Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Repost Desk — TikTok clip fetcher & caption writer",
  description:
    "Pull TikTok clips with their original captions, auto-write repost-ready captions with creator credit, and run your relatable-content queue.",
};

function buildStamp(): string {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const env =
    process.env.VERCEL_ENV ??
    (process.env.NODE_ENV === "production" ? "production" : "development");
  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  return [env, ref, commit].filter(Boolean).join(" · ");
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const stamp = buildStamp();
  return (
    <html
      lang="en"
      className={`${chakra.variable} ${manrope.variable} ${plex.variable}`}
    >
      <body className="bg-ink font-body text-text antialiased">
        {children}
        <div className="noise-overlay" aria-hidden="true" />
        <div className="build-stamp mono-num" title="deployment build">
          {stamp}
        </div>
      </body>
    </html>
  );
}
