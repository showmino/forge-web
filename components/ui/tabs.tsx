"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

// Tabs switch between parts of one page. The arrow keys move between them, as
// in any tab list.
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);

  function onKey(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.value === value);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  }

  return (
    <>
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-6 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${id}-${t.value}`}
              aria-selected={on}
              aria-controls={`${id}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.value)}
              className={`-mb-px cursor-pointer whitespace-nowrap border-b-2 py-2.5 font-medium ${
                on ? "border-ember text-fg" : "border-transparent text-fg-3 hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} className="flex min-w-0 flex-col gap-8">
        {children}
      </div>
    </>
  );
}
