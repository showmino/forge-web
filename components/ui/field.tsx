import type { ReactNode } from "react";
import { Glyph } from "./status";

// The design system's Field: a label above the input, a hint that says what a
// good value looks like, and the error in its place when the value is wrong.
export const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-muted aria-[invalid=true]:border-danger";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex max-w-[360px] flex-col gap-1">
      <label htmlFor={id} className="type-small font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-note`} role="alert" className="flex items-center gap-1 type-small text-danger">
          <Glyph tone="danger" />
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-note`} className="type-small text-ink-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
