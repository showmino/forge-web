import type { ReactNode } from "react";
import { Glyph } from "./status";

// The design system's Field: a label above the input, a hint that says what a
// good value looks like, and the error in its place when the value is wrong.
export const inputClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-3 text-fg placeholder:text-fg-2 aria-[invalid=true]:border-bad-dot";

export function Field({
  id,
  label,
  aside,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  // Shown after the label but not part of it, so the input keeps its plain name.
  aside?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex max-w-[360px] flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="type-small font-semibold">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <span id={`${id}-note`} role="alert" className="flex items-center gap-1 type-small text-bad-fg">
          <Glyph tone="danger" />
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-note`} className="type-small text-fg-2">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
