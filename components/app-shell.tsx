"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CommandPalette } from "@/components/command-palette";
import { useApi } from "@/components/providers";
import { listAllServices } from "@/lib/api";
import { clearSession, loadSession, SESSION_KEY, type Session } from "@/lib/auth/session";

// The shell of the Forge design language: a dark iron rail beside a light work
// surface. On a narrow screen the rail slides in over the page.

// Where this browser keeps whether the wide rail is open ("full") or icons only.
const RAIL_KEY = "forge.rail";

const icon = {
  services: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  overview: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  templates: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  operations: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  docs: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 17z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 17z" />
    </>
  ),
  environments: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  deployments: (
    <>
      <path d="M4 12h11M11 6l6 6-6 6" />
      <path d="M20 4v16" />
    </>
  ),
  ownership: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
};

type Item = { href: string; label: string; icon: keyof typeof icon; match: (p: string) => boolean };
const groups: { label: string; items: Item[] }[] = [
  { label: "", items: [{ href: "/", label: "Overview", icon: "overview", match: (p) => p === "/" }] },
  {
    label: "Build",
    items: [
      {
        href: "/services",
        label: "Services",
        icon: "services",
        match: (p) => p.startsWith("/services") || p.startsWith("/create"),
      },
      { href: "/templates", label: "Templates", icon: "templates", match: (p) => p.startsWith("/templates") },
      { href: "/docs", label: "Docs", icon: "docs", match: (p) => p.startsWith("/docs") },
    ],
  },
  {
    label: "Run",
    items: [
      { href: "/environments", label: "Environments", icon: "environments", match: (p) => p.startsWith("/environments") },
      { href: "/deployments", label: "Deployments", icon: "deployments", match: (p) => p.startsWith("/deployments") },
      { href: "/operations", label: "Operations", icon: "operations", match: (p) => p.startsWith("/operations") },
    ],
  },
  {
    label: "Govern",
    items: [
      { href: "/ownership", label: "Ownership", icon: "ownership", match: (p) => p.startsWith("/ownership") },
      { href: "/audit", label: "Audit log", icon: "audit", match: (p) => p.startsWith("/audit") },
    ],
  },
];

// useCanWrite asks the API what the reader may do. It only hides buttons a
// reader cannot use: the API still decides every call.
export function useCanWrite(): boolean {
  const api = useApi();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.auth.getStatus({}), staleTime: 5 * 60_000 });
  return status.data?.permissions.includes("services.write") ?? false;
}

// AppShell is the frame of every page behind the login: the rail, the top bar,
// and the gate that sends a reader without a login to the login page.
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [session, setSession] = useState<Session | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // On a wide screen the rail is icons only unless the reader opened it; the
  // choice is kept in this browser.
  const [mini, setMini] = useState(true);
  const [jumping, setJumping] = useState(false);
  // Counts the changes other tabs made to the session, to look at it again.
  const [tabs, setTabs] = useState(0);
  const rail = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      // The login has ended: show nothing more of the page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      const here = window.location.pathname + window.location.search;
      router.replace("/login?return=" + encodeURIComponent(here));
      return;
    }
    // The session lives in the browser only, so it is read after the page
    // mounts. Keep the same object for the same login, so nothing re-renders.
    setSession((prev) => (prev?.token === s.token ? prev : s));
    // Going to another page closes the rail on a narrow screen.
    setNavOpen(false);
  }, [router, pathname, tabs]);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only there after mount
      setMini(localStorage.getItem(RAIL_KEY) !== "full");
    } catch {
      // Not stored: icons only.
    }
  }, []);

  function toggleRail() {
    setMini((m) => {
      try {
        localStorage.setItem(RAIL_KEY, m ? "full" : "min");
      } catch {
        // The choice then lasts for this page only.
      }
      return !m;
    });
  }

  // The session is shared by every tab: signing out in one signs out here.
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key === SESSION_KEY || e.key === null) setTabs((n) => n + 1);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  // Ctrl+K or ⌘K opens the palette from anywhere, and closes it again.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumping((j) => !j);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The open rail (narrow screens only) takes the focus, and Escape or the
  // scrim closes it and gives the focus back to the menu button.
  useEffect(() => {
    if (!navOpen) return;
    rail.current?.querySelector<HTMLElement>("a, button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setNavOpen(false);
      menu.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  function closeNav() {
    setNavOpen(false);
    menu.current?.focus();
  }

  if (!session) return null;
  return (
    <div
      className={`grid min-h-screen grid-cols-[minmax(0,1fr)] rail:transition-[grid-template-columns] rail:duration-200 motion-reduce:transition-none ${
        mini ? "rail:grid-cols-[64px_minmax(0,1fr)]" : "rail:grid-cols-[232px_minmax(0,1fr)]"
      }`}
    >
      {navOpen ? <div className="fixed inset-0 z-[35] bg-scrim rail:hidden" onClick={closeNav} /> : null}
      <Rail pathname={pathname} session={session} open={navOpen} mini={mini} onToggle={toggleRail} railRef={rail} />
      <div className="flex min-w-0 flex-col">
        <TopBar onMenu={() => setNavOpen(true)} onJump={() => setJumping(true)} open={navOpen} menuRef={menu} />
        <main className="flex w-full max-w-[1320px] flex-col gap-8 px-4 pb-12 pt-6 rail:px-8 rail:pt-8">{children}</main>
      </div>
      {jumping ? <CommandPalette onClose={() => setJumping(false)} /> : null}
    </div>
  );
}

function Rail({
  pathname,
  session,
  open,
  mini,
  onToggle,
  railRef,
}: {
  pathname: string;
  session: Session;
  open: boolean;
  mini: boolean;
  onToggle: () => void;
  railRef: RefObject<HTMLElement | null>;
}) {
  const api = useApi();
  const router = useRouter();
  const canWrite = useCanWrite();
  // The same list the Services page shows, so the count costs nothing extra there.
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const who = session.email || session.subject;
  const short = who.split("@")[0];
  // Icons only applies on a wide screen; the narrow rail slides in at full width.
  const m = (cls: string) => (mini ? cls : "");

  return (
    <aside
      id="rail"
      ref={railRef}
      aria-label="Primary"
      // Closed on a narrow screen it is hidden, not just moved away: nothing in it can take the focus.
      className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col gap-4 bg-rail-bg px-3 py-4 text-rail-fg transition-transform duration-200 motion-reduce:transition-none rail:visible rail:sticky rail:top-0 rail:h-screen rail:w-auto rail:translate-x-0 ${m("rail:items-center rail:px-2.5")} ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
    >
      <Link href="/" aria-label="Forge home" className={`flex items-center gap-2.5 px-2 pb-1.5 pt-0.5 no-underline ${m("rail:px-0")}`}>
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="3" y="3" width="20" height="5" rx="1" fill="currentColor" />
          <rect x="3" y="10.5" width="13" height="5" rx="1" fill="currentColor" />
          <rect x="3" y="18" width="7" height="5" rx="1" fill="var(--ember)" />
        </svg>
        <span className={`font-display text-[19px] font-[750] tracking-[0.01em] [font-stretch:118%] ${m("rail:hidden")}`}>forge</span>
      </Link>
      <nav aria-label="Main" className={`flex flex-col gap-0.5 ${m("rail:w-full rail:items-center")}`}>
        {groups.map((group) => (
          <div key={group.label || "home"} className={`flex flex-col gap-0.5 ${m("rail:w-full rail:items-center")}`}>
            {group.label ? (
              <div className={`px-2.5 pb-1.5 pt-3 text-[11px] uppercase tracking-[0.08em] text-rail-fg-2 ${m("rail:hidden")}`}>{group.label}</div>
            ) : null}
            {group.label && mini ? <div aria-hidden="true" className="my-2 hidden h-px w-6 bg-rail-line rail:block" /> : null}
            {group.items.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={mini ? item.label : undefined}
                  className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] font-medium no-underline ${m("rail:h-9 rail:w-10 rail:justify-center rail:p-0")} ${
                    active
                      ? `bg-rail-active text-rail-fg before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-[3px] before:bg-ember before:content-[''] ${m("rail:before:-left-2.5")}`
                      : "text-rail-fg-2 hover:bg-rail-active/60 hover:text-rail-fg"
                  }`}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="flex-none opacity-90"
                  >
                    {icon[item.icon]}
                  </svg>
                  <span className={m("rail:sr-only")}>{item.label}</span>
                  {item.icon === "services" && services.data ? (
                    <>
                      {/* A space, so the link reads "Services 2" and not "Services2". */}{" "}
                      <span className={`ml-auto font-mono text-[11px] text-rail-fg-2 ${m("rail:hidden")}`}>{services.data.length}</span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!mini}
        aria-label={mini ? "Expand sidebar" : "Collapse sidebar"}
        title={mini ? "Expand sidebar" : undefined}
        className={`mt-auto hidden cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[7px] font-medium text-rail-fg-2 hover:bg-rail-active/60 hover:text-rail-fg rail:flex ${m("rail:h-9 rail:w-10 rail:justify-center rail:p-0")}`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d={mini ? "M13.5 10l2 2-2 2" : "M15.5 10l-2 2 2 2"} />
        </svg>
        <span className={m("rail:hidden")}>Collapse</span>
      </button>
      <div className={`flex flex-col gap-2 border-t border-rail-line px-2 pt-3 max-rail:mt-auto ${m("rail:w-full rail:items-center rail:px-0")}`}>
        <div className="flex items-center gap-2.5">
          <span
            title={mini ? `${who} · ${canWrite ? "Writer" : "Reader"}` : undefined}
            className="inline-grid size-7 flex-none place-items-center rounded-full bg-rail-active text-[11px] font-semibold uppercase"
          >
            {short.slice(0, 2)}
          </span>
          <span className={`min-w-0 text-[13px] leading-tight ${m("rail:hidden")}`}>
            <span className="block truncate">{short}</span>
            <small className="block truncate text-[11.5px] text-rail-fg-2">{who}</small>
          </span>
          <span className={`ml-auto rounded-sm bg-rail-active px-1.5 py-px text-[11px] font-semibold ${m("rail:hidden")}`}>{canWrite ? "Writer" : "Reader"}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            // End the session on the API too, so its token is worth nothing
            // any more. Signing out here does not wait for that.
            if (session?.forge) void api.auth.deleteSession({ name: "sessions/current" }).catch(() => {});
            clearSession();
            router.replace("/login");
          }}
          className={`cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-rail-fg-2 hover:bg-rail-active/60 hover:text-rail-fg ${m("rail:grid rail:size-9 rail:place-items-center rail:p-0")}`}
          title={mini ? "Sign out" : undefined}
        >
          {mini ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden rail:block">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />
            </svg>
          ) : null}
          <span className={m("rail:sr-only")}>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

// toggleTheme flips between the light and dark palettes and remembers the choice in this browser.
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("forge.theme", next);
  } catch {
    // The choice then lasts for this page only.
  }
}

const iconButton =
  "inline-grid size-8 cursor-pointer place-items-center rounded-md border border-transparent text-fg-2 hover:bg-surface-2 hover:text-fg";

function TopBar({
  onMenu,
  onJump,
  open,
  menuRef,
}: {
  onMenu: () => void;
  onJump: () => void;
  open: boolean;
  menuRef: RefObject<HTMLButtonElement | null>;
}) {
  // The server cannot know the reader's keyboard: the page says Ctrl until it can.
  const [mac, setMac] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur-md rail:px-8">
      <button
        ref={menuRef}
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="rail"
        className={`${iconButton} rail:hidden`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onJump}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-w-0 max-w-[420px] flex-1 cursor-text items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-fg-3"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4-4" />
        </svg>
        <span className="min-w-0 flex-1 truncate">Jump to…</span>
        <kbd className="hidden rounded-sm border border-b-2 border-line bg-surface-2 px-[5px] font-mono text-[11px] text-fg-2 rail:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={toggleTheme} aria-label="Switch color theme" className={iconButton}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  );
}
