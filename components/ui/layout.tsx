import type { ReactNode } from "react";
import { errorText } from "@/lib/api";
import { Glyph } from "./status";

// The page furniture of the design system: a title, panels and the table frame.

export function PageHeader({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="type-title">{title}</h1>
        {lead ? <p className="mt-1 text-ink-muted">{lead}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-heading">{title}</h2>
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

// TableFrame scrolls sideways on its own when the screen is narrow; the page never does.
export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table aria-label={label} className="w-full border-collapse tabular-nums">
        {children}
      </table>
    </div>
  );
}

export const th =
  "whitespace-nowrap border-b border-border bg-surface-sunken px-4 py-2 text-left type-label uppercase tracking-[0.04em] text-ink-muted";
export const td = "h-10 whitespace-nowrap border-b border-border px-4 py-2";
export const tr = "hover:bg-accent-soft [&:last-child>td]:border-b-0";

// Empty says what would be here and how to get the first one.
export function Empty({ children }: { children: ReactNode }) {
  return <Panel className="px-6 py-12 text-center text-ink-muted">{children}</Panel>;
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-ink-muted">
      <Glyph tone="progress" />
      Loading {what}
    </p>
  );
}

// ErrorNote says what went wrong and what to do next.
export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-danger">
      <Glyph tone="danger" />
      {error instanceof Error && error.name !== "ConnectError" ? error.message : errorText(error)}
    </p>
  );
}

// Facts is a list of labelled values: the details of one thing.
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
