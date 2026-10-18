import type { ReactNode } from "react";
import { errorText } from "@/lib/api";
import { TextLink } from "./button";
import { Cli } from "./cli";
import { Glyph } from "./status";

// The page furniture of the Forge design language: every screen is a title,
// one primary action, its CLI equivalent, then summary before detail.

// PageHeader is the top of a page. cli is the command that does the same from
// the terminal; mono sets a title that is a name the way it is typed.
export function PageHeader({
  title,
  lead,
  crumbs,
  cli,
  mono = false,
  children,
}: {
  title: string;
  lead?: ReactNode;
  crumbs?: ReactNode;
  cli?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
        {crumbs}
        <h1 className={mono ? "break-words font-mono text-[28px] font-semibold leading-[1.1] tracking-[-0.01em]" : "type-title"}>
          {title}
        </h1>
        {lead ? <p className="max-w-[62ch] text-fg-2">{lead}</p> : null}
        {cli ? <Cli command={cli} /> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

// Crumbs says where the page sits: "Services / platform-engineering".
export function Crumbs({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-fg-3 [&_a]:text-fg-2 [&_a]:no-underline hover:[&_a]:underline">
      {children}
    </nav>
  );
}

// Section is a titled part of a page. note is a quiet remark beside the title; action sits at the right.
export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="type-heading">{title}</h2>
        {note ? <span className="text-[13px] text-fg-3 tabular-nums">{note}</span> : null}
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

// Panel sits on a 1px line with a faint shadow. Only dialogs float.
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-lg border border-line bg-surface shadow-1 ${className}`}>{children}</div>;
}

// Widget is a self-contained card: title (and an optional note or a link to
// the full page) inside the same border as its content. For a dashboard of
// several at-a-glance summaries side by side, where Section's title floating
// above a separate Panel would read as more than one thing per summary.
export function Widget({
  title,
  note,
  link,
  children,
}: {
  title: string;
  note?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-1">
      <div className="flex flex-wrap items-baseline gap-3 px-6 pt-4 pb-3">
        <h2 className="type-heading">{title}</h2>
        {note !== undefined ? <span className="text-[13px] text-fg-3 tabular-nums">{note}</span> : null}
        {link ? (
          <TextLink href={link.href} className="ml-auto text-[12.5px] text-fg-2">
            {link.label}
          </TextLink>
        ) : null}
      </div>
      <div className="min-w-0 px-6 pb-6">{children}</div>
    </section>
  );
}

// TableFrame scrolls sideways on its own when the screen is narrow; the page never does.
export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-1">
      <table aria-label={label} className="w-full border-collapse text-[13.5px] tabular-nums">
        {children}
      </table>
    </div>
  );
}

export const th = "whitespace-nowrap border-b border-line bg-surface-2 px-4 py-[9px] text-left type-label text-fg-3";
export const td = "whitespace-nowrap border-b border-line px-4 py-[11px] align-middle";
export const tr = "[&:last-child>td]:border-b-0 hover:[&>td]:bg-surface-2";

// Empty says what would be here and how to get the first one.
export function Empty({ children }: { children: ReactNode }) {
  return <Panel className="p-6 text-center text-[13.5px] text-fg-2">{children}</Panel>;
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-fg-2">
      <span className="text-ember">
        <Glyph tone="progress" />
      </span>
      Loading {what}
    </p>
  );
}

// ErrorNote says what went wrong and what to do next.
export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md bg-bad-bg px-3.5 py-2.5 text-[13.5px] text-bad-fg">
      <Glyph tone="danger" />
      {error instanceof Error && error.name !== "ConnectError" ? error.message : errorText(error)}
    </p>
  );
}

// Facts is a list of labelled values: the details of one thing.
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-3">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
