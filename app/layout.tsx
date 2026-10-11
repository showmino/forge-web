import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// The three faces of the Forge design language, served by the app itself.
// Archivo is variable in weight and width: titles are set a little expanded.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const plexSans = IBM_Plex_Sans({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-plex-mono" });

const THEME = `try{var t=localStorage.getItem("forge.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Forge",
  description: "The services, templates, deploys and audit log of Forge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-fg type-body antialiased">
        {/* The reader's theme choice, applied before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
