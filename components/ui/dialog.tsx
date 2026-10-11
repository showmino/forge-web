"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]";

// The design system's Dialog: it stops the reader to confirm one action.
// Focus moves in when it opens, stays in while it is open, and returns to
// where it was when it closes. Escape closes it without doing anything.
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = panel.current;
    (box?.querySelector<HTMLElement>(FOCUSABLE) ?? box)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-scrim p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-3"
      >
        <h2 id={titleId} className="type-heading">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

// DialogActions holds the two buttons: "Cancel" first, then the action.
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}
