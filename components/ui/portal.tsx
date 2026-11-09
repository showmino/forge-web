import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/status";

// The console's cards, numbers, tabs, filters and lists: the pieces the home
// page, the Catalog, a service's page and Deployments are built from.

const paths = {
  rocket: (
    <>
      <path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2" />
      <path d="M9 15l-3-3c1-3.5 4.5-9 12-9 0 7.5-5.5 11-9 12z" />
      <circle cx="14.5" cy="9.5" r="1.5" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 17z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 17z" />
    </>
  ),
  box: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  ship: (
    <>
      <path d="M4 12h11M11 6l6 6-6 6" />
      <path d="M20 4v16" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6z" />,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  gauge: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12l3.5-3.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  term: <path d="M5 8l4 4-4 4M12 17h7" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  chev: <path d="M9 6l6 6-6 6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M7 7l10 10M17 7L7 17" />,
  ext: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
};

export type GlyphName = keyof typeof paths;

// Mark is one of the console's line icons. Decorative: the text beside it says what it is.
export function Mark({ name, size = 18, className = "" }: { name: GlyphName; size?: number; className?: string }) {
  const bold = name === "check" || name === "cross";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={bold ? 3 : 1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      {paths[name]}
    </svg>
  );
}

// Card is a titled box of the console: an icon, a title, an optional link to
// the full page, then its contents.
export function Card({
  icon,
  title,
  more,
  flush = false,
  className = "",
  children,
}: {
  icon?: GlyphName;
  title?: ReactNode;
  more?: { href: string; label: string };
  // flush lets a table run to the card's edges.
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-1 ${flush ? "overflow-hidden" : "px-5 pt-[18px] pb-4 max-[700px]:p-4"} ${className}`}>
      {title ? (
        <div className={`mb-3 flex items-center gap-3 ${flush ? "px-5 pt-[18px]" : ""}`}>
          {icon ? (
            <span className="grid size-8 flex-none place-items-center text-fg">
              <Mark name={icon} />
            </span>
          ) : null}
          <h2 className="m-0 font-display text-[17px] font-[650] [font-stretch:104%]">{title}</h2>
          {more ? <More href={more.href}>{more.label}</More> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// More is a card's link to where its list goes on: "View catalog →".
export function More({ href, children, className = "ml-auto" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-[5px] whitespace-nowrap text-[13px] font-medium text-ember-ink no-underline hover:underline ${className}`}>
      {children}
      <Mark name="arrow" size={14} />
    </Link>
  );
}

// CardNote is the quiet line under a card's title or at its end.
export function CardNote({ children, top = false }: { children: ReactNode; top?: boolean }) {
  return <p className={top ? "-mt-1 mb-2.5 text-[13.5px] text-fg-2" : "mt-2 mb-0 text-[13px] text-fg-3"}>{children}</p>;
}

const chipTone: Record<Tone, string> = {
  success: "bg-ok-bg text-ok-fg",
  warning: "bg-warn-bg text-warn-fg",
  danger: "bg-bad-bg text-bad-fg",
  progress: "bg-ember-soft text-ember-ink",
  neutral: "bg-surface-2 text-fg-2",
};

// Stat is one of the four numbers across the top of a page: an icon, a label,
// the number, and a chip that says how it is going.
export function Stat({ icon, label, value, chip, tone = "neutral" }: { icon: GlyphName; label: string; value: ReactNode; chip?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-lg border border-line bg-surface px-5 py-[18px] shadow-1 max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-2.5 max-[700px]:p-3.5">
      <span className="grid size-[42px] flex-none place-items-center rounded-[10px] bg-surface-2 text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] max-[700px]:size-[34px]">
        <Mark name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] text-fg-2">{label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-display text-[28px] leading-[1.15] font-bold tabular-nums [font-stretch:108%]">{value}</span>
          {chip ? <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${chipTone[tone]}`}>{chip}</span> : null}
        </div>
      </div>
    </div>
  );
}

// Stats is the row of four numbers.
export function Stats({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-4 gap-4 max-[1200px]:grid-cols-2 max-[700px]:gap-2.5">
      {children}
    </section>
  );
}

const healthTone: Record<Tone, string> = {
  success: "text-ok-fg [&>i]:bg-ok-dot",
  warning: "text-warn-fg [&>i]:bg-warn-dot",
  danger: "text-bad-fg [&>i]:bg-bad-dot",
  progress: "text-ember-ink [&>i]:bg-ember",
  neutral: "text-fg-2 [&>i]:bg-fg-3",
};

// Health is a big word with a dot, where a Stat's number would be: "Healthy".
export function Health({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-[9px] font-display text-[22px] leading-[1.3] font-bold max-[700px]:text-[19px] ${healthTone[tone]}`}>
      <i aria-hidden="true" className="size-2.5 rounded-full" />
      {children}
    </span>
  );
}

// Tabs across a page that link to its siblings: Services, Templates, Resources.
export function PageTabs({ tabs, label }: { tabs: { label: string; href: string; count?: number; current?: boolean; icon?: GlyphName }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-[14px] font-medium whitespace-nowrap no-underline ${
            t.current ? "border-ember text-fg [&_svg]:text-ember" : "border-transparent text-fg-2 hover:text-fg [&_svg]:text-fg-3"
          }`}
        >
          {t.icon ? <Mark name={t.icon} size={16} /> : null}
          {t.label}
          {t.count !== undefined ? (
            <span className={`rounded-full px-[7px] text-[11.5px] font-semibold ${t.current ? "bg-ember-soft text-ember-ink" : "bg-surface-2 text-fg-2 shadow-[inset_0_0_0_1px_var(--line)]"}`}>
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

// FilterBar holds a search field and the filters beside it, in one row.
export function FilterBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="search" aria-label={label} className="flex flex-wrap items-center gap-2.5">
      {children}
    </div>
  );
}

const field =
  "rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] focus:border-ember focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ember)_25%,transparent)] focus:outline-none";

// Find is the search field of a FilterBar.
export function Find({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative max-w-[380px] flex-[1_1_260px] max-[700px]:max-w-none max-[700px]:basis-full">
      <span className="absolute top-1/2 left-[11px] -translate-y-1/2 text-fg-3">
        <Mark name="search" size={15} />
      </span>
      <span className="sr-only">{label}</span>
      <input type="search" className={`${field} w-full pl-[34px]`} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
    </label>
  );
}

// Choose is one filter of a FilterBar: "Owner: All".
export function Choose({ label, value, options, onChange }: { label: string; value: string; options: [value: string, text: string][]; onChange: (v: string) => void }) {
  return (
    <label className="max-[700px]:flex-[1_1_calc(50%-5px)]">
      <span className="sr-only">{label}</span>
      <select className={`${field} text-[13px] max-[700px]:w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {label}: {text}
          </option>
        ))}
      </select>
    </label>
  );
}

// The console's tables: quiet headers, rows divided by a line.
export const ct = "w-full border-collapse text-[13.5px] tabular-nums";
export const cth = "border-b border-line px-2 pt-1.5 pb-2 text-left text-[12.5px] font-medium whitespace-nowrap text-fg-2";
export const ctd = "border-b border-line px-2 py-[9px] whitespace-nowrap [tr:last-child>&]:border-b-0";
// The big variant runs to a flush card's edges.
export const bth = "border-b border-line bg-surface-2 px-4 py-3 text-left text-[12.5px] font-medium whitespace-nowrap text-fg-2 max-[700px]:px-3 max-[700px]:py-2.5";
export const btd = "border-b border-line px-4 py-3 whitespace-nowrap [tr:last-child>&]:border-b-0 max-[700px]:px-3 max-[700px]:py-2.5";
// Columns that give way on a phone.
export const wide = "max-[700px]:hidden";

// ServiceName is a service in a table: the box mark, its name (the link), and a line under it.
export function ServiceName({ id, sub, href = `/services/${id}` }: { id: string; sub?: string; href?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold">
      <span className="text-ember">
        <Mark name="box" size={17} />
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <Link href={href} className="font-mono text-[0.95em] text-inherit no-underline hover:underline">
          {id}
        </Link>
        {sub ? <span className="max-w-[340px] truncate text-[12.5px] font-normal text-fg-3 max-[700px]:max-w-[200px]">{sub}</span> : null}
      </span>
    </span>
  );
}

// Chip is a quiet label in a table: a team, or an environment in the code face.
export function Chip({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-[9px] py-0.5 text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] ${mono ? "font-mono text-[12px]" : "text-[12.5px]"}`}>
      {children}
    </span>
  );
}

export type Need = { key: string; tone: "bad" | "warn"; text: ReactNode; why: ReactNode; action?: ReactNode };

// Needs is a list of problems: a dot, what is wrong, why, and what to do.
export function Needs({ items, max, label }: { items: Need[]; max: number; label: string }) {
  const more = items.length - max;
  return (
    <>
      <ul aria-label={label} className="m-0 list-none p-0">
        {items.slice(0, max).map((n) => (
          <li key={n.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5 last:border-b-0 max-[700px]:grid-cols-[auto_minmax(0,1fr)]">
            <span aria-hidden="true" className={`mt-[7px] size-2 self-start rounded-full ${n.tone === "bad" ? "bg-bad-dot" : "bg-warn-dot"}`} />
            <div className="min-w-0 text-[13.5px]">
              <div className={n.tone === "bad" ? "[&_.what]:text-bad-fg" : "[&_.what]:text-warn-fg"}>{n.text}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-fg-3 max-[700px]:whitespace-normal">{n.why}</div>
            </div>
            {n.action ? <div className="flex gap-1.5 max-[700px]:col-start-2">{n.action}</div> : null}
          </li>
        ))}
      </ul>
      {more > 0 ? <CardNote>And {more} more.</CardNote> : null}
    </>
  );
}

export type Activity = { key: string; tone: "ok" | "bad" | "run"; ref: string; text: ReactNode; when: string };

const activityLook = { ok: "bg-ok-dot text-on-bad", bad: "bg-bad-dot text-on-bad", run: "bg-ember-soft text-ember-ink" };

// Activities is what happened lately, newest first: a round mark, the ref, what, and when.
export function Activities({ items, label, empty }: { items: Activity[]; label: string; empty: string }) {
  if (items.length === 0) return <CardNote>{empty}</CardNote>;
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((a) => (
        <li
          key={a.key}
          className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-[9px] text-[13.5px] last:border-b-0 max-[700px]:grid-cols-[auto_minmax(0,1fr)] max-[700px]:gap-y-0.5"
        >
          <span className={`grid size-6 place-items-center rounded-full ${activityLook[a.tone]}`}>
            <Mark name={a.tone === "ok" ? "check" : a.tone === "bad" ? "cross" : "ship"} size={a.tone === "run" ? 13 : 12} />
          </span>
          <span className="font-mono text-[12.5px] text-fg-2 max-[700px]:hidden">{a.ref || "–"}</span>
          <span className="truncate">{a.text}</span>
          <span className="text-[12.5px] whitespace-nowrap text-fg-3 max-[700px]:col-start-2">{a.when}</span>
        </li>
      ))}
    </ul>
  );
}

const lineTone: Record<Tone, string> = {
  success: "text-ok-fg [&>i]:bg-ok-dot",
  warning: "rounded-full bg-warn-bg px-[9px] py-px text-warn-fg [&>i]:bg-warn-dot",
  danger: "rounded-full bg-bad-bg px-[9px] py-px text-bad-fg [&>i]:bg-bad-dot",
  progress: "text-ember-ink [&>i]:bg-ember",
  neutral: "text-fg-3 [&>i]:bg-fg-3",
};

// StatusLines is the platform at a glance: one line per part, and how it is.
export function StatusLines({ items, label }: { items: { label: string; href: string; tone: Tone; word: string }[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((s) => (
        <li key={s.label}>
          <Link href={s.href} className="group flex items-center justify-between border-b border-line py-2.5 text-[14px] text-inherit no-underline [li:last-child>&]:border-b-0">
            <span className="group-hover:underline">{s.label}</span>
            <span className={`inline-flex items-center gap-[7px] text-[13px] font-medium ${lineTone[s.tone]}`}>
              <i aria-hidden="true" className="size-[7px] rounded-full" />
              {s.word}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// LinkList is a short list of places to go, each with an icon and a line.
export function LinkList({ items, label }: { items: { href: string; icon: GlyphName; title: string; sub: string; external?: boolean }[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((l) => {
        const inner = (
          <>
            <span className="grid size-[38px] flex-none place-items-center rounded-[10px] bg-ember-soft text-ember">
              <Mark name={l.icon} />
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <b className="text-[14px] font-semibold group-hover:underline">{l.title}</b>
              <span className="text-[12.5px] text-fg-3">{l.sub}</span>
            </span>
            <span className="ml-auto text-fg-3">
              <Mark name={l.external ? "ext" : "chev"} size={15} />
            </span>
          </>
        );
        const cls = "group flex items-center gap-3.5 border-b border-line py-[9px] text-inherit no-underline [li:last-child>&]:border-b-0";
        return (
          <li key={l.title}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer" className={cls}>
                {inner}
              </a>
            ) : (
              <Link href={l.href} className={cls}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Steps is a checklist of links: what is done is ticked and struck through.
export function Steps({ items, label }: { items: { done: boolean; text: string; href: string }[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((s) => (
        <li key={s.text}>
          <Link
            href={s.href}
            className={`group flex items-center gap-3 border-b border-line px-0.5 py-[9px] text-[14px] no-underline [li:last-child>&]:border-b-0 ${s.done ? "text-fg-3" : "text-inherit"}`}
          >
            <span
              className={`grid size-5 flex-none place-items-center rounded-full ${s.done ? "bg-ember text-ember-on" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]"}`}
            >
              {s.done ? <Mark name="check" size={13} /> : null}
            </span>
            <span className={s.done ? "line-through" : "group-hover:underline"}>
              {s.text}
              {s.done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {s.done ? null : (
              <span className="ml-auto text-fg-3">
                <Mark name="chev" size={15} />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
