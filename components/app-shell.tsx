"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { clearSession, loadSession, type Session } from "@/lib/auth/session";

const nav = [
  { href: "/", label: "Services", match: (p: string) => p === "/" || p.startsWith("/services") || p.startsWith("/create") },
  { href: "/templates", label: "Templates", match: (p: string) => p.startsWith("/templates") },
  { href: "/operations", label: "Operations", match: (p: string) => p.startsWith("/operations") },
  { href: "/audit", label: "Audit log", match: (p: string) => p.startsWith("/audit") },
];

// useCanWrite asks the API what the reader may do. It only hides buttons a
// reader cannot use: the API still decides every call.
export function useCanWrite(): boolean {
  const api = useApi();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.auth.getStatus({}), staleTime: 5 * 60_000 });
  return status.data?.permissions.includes("services.write") ?? false;
}

// AppShell is the frame of every page behind the login: the header, and the
// gate that sends a reader without a login to the login page.
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      const here = window.location.pathname + window.location.search;
      router.replace("/login?return=" + encodeURIComponent(here));
      return;
    }
    // The session lives in the browser only, so it is read after the page
    // mounts. Keep the same object for the same login, so nothing re-renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession((prev) => (prev?.token === s.token ? prev : s));
  }, [router, pathname]);

  if (!session) return null;
  return (
    <>
      <Header pathname={pathname} session={session} />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 md:px-8">{children}</main>
    </>
  );
}

function Header({ pathname, session }: { pathname: string; session: Session }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex min-h-12 max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 type-heading">
          <span aria-hidden="true" className="size-3 bg-heat" />
          Forge
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4">
          {nav.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 py-3 type-body-strong ${active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-ink-muted sm:inline">{session.email || session.subject}</span>
          <span className="rounded-sm bg-surface-sunken px-2 py-0.5 type-label text-ink-muted">
            {canWrite ? "Writer" : "Reader"}
          </span>
          <Button
            kind="quiet"
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
