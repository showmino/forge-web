import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";

// The three faces of the Forge design language. Their files are in the repo
// (app/fonts, Latin subsets, under the SIL Open Font License), so a build
// fetches nothing and the app serves them itself. Archivo is variable in
// weight and width: titles are set a little expanded.
const archivo = localFont({
  src: "./fonts/archivo-latin-wdth-normal.woff2",
  weight: "100 900",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  variable: "--font-archivo",
});
// The font loader reads these calls when the app is built: every value is written out.
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
});

const THEME = `try{var t=localStorage.getItem("forge.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Forge",
  description: "The services, templates, deploys and audit log of Forge.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every script on a page carries the nonce of its request (proxy.ts); the
  // policy lets nothing else run. Reading it here also makes every page
  // rendered per request, which a nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="min-h-[var(--vh)] bg-bg text-fg type-body antialiased [zoom:var(--zoom)]">
        {/* The reader's theme choice, applied before the first paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
