import type { Metadata } from "next";
import "./globals.css";
import { displayName } from "@/lib/display-name";

export const metadata: Metadata = {
  title: displayName("forge-web"),
  description: "forge-web, owned by platform-engineering",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
