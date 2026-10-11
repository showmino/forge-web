import type { Metadata } from "next";
import { Barlow_Semi_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// The three faces of the design system, served by the app itself.
const barlow = Barlow_Semi_Condensed({ weight: "600", subsets: ["latin"], variable: "--font-barlow" });
const plexSans = IBM_Plex_Sans({ weight: ["400", "600"], subsets: ["latin"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ weight: "400", subsets: ["latin"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "Forge",
  description: "The services, templates, deploys and audit log of Forge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${barlow.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-bg text-ink type-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
