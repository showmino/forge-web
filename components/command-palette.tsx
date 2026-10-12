"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useApi } from "@/components/providers";
import { listAllServices } from "@/lib/api";
import { filterJumps, jumpItems } from "@/lib/palette";

// CommandPalette jumps to a page, a service or a preview by typing part of its
// name. Ctrl+K or ⌘K opens it from anywhere; Escape or a click outside closes it.
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const previews = useQuery({
    queryKey: ["environments"],
    queryFn: () => api.environments.listEnvironments({}).then((r) => r.environments),
  });
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const items = filterJumps(jumpItems(services.data ?? [], previews.data ?? []), query);
  const current = Math.min(at, Math.max(items.length - 1, 0));

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => before?.focus();
  }, []);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setAt((current + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setAt((current - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && items[current]) {
      e.preventDefault();
      go(items[current].href);
    } else if (e.key === "Tab") {
      // The input is the only place to be while the palette is open.
      e.preventDefault();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start bg-scrim p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="mx-auto mt-[12vh] w-full max-w-[560px] overflow-hidden rounded-lg bg-surface shadow-3">
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
          aria-label="Jump to"
          autoComplete="off"
          spellCheck={false}
          placeholder="Jump to a service, preview or page"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={onKey}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] text-fg outline-none placeholder:text-fg-3"
        />
        <ul id={listId} role="listbox" aria-label="Places" className="max-h-[320px] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <li className="px-4 py-3.5 text-fg-3">Nothing matches. Try a service name.</li>
          ) : (
            items.map((item, i) => (
              <li
                key={`${item.kind}:${item.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setAt(i)}
                onClick={() => go(item.href)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${i === current ? "bg-surface-2" : ""}`}
              >
                <span className={item.mono ? "font-mono text-[13px]" : ""}>{item.label}</span>
                <span className="ml-auto text-[12px] text-fg-3">{item.kind}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
