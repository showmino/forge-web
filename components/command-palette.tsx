"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useApi } from "@/components/providers";
import { Marked } from "@/components/ui/marked";
import { listAllServices, serviceId } from "@/lib/api";
import { docHref, plainLine, searchTerms } from "@/lib/docs";
import { filterJumps, jumpItems, type JumpItem } from "@/lib/palette";

// The docs are searched once this much is typed and the typing has paused.
const MIN_SEARCH = 2;
const PAUSE_MS = 250;
const DOC_RESULTS = 5;

// CommandPalette jumps to a page, a service, a template or a preview by typing
// part of its name, and finds the pages of every service's docs that hold the
// words typed. Ctrl+K or ⌘K opens it from anywhere; Escape or a click outside
// closes it.
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const previews = useQuery({
    queryKey: ["environments"],
    queryFn: () => api.environments.listEnvironments({}).then((r) => r.environments),
  });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api.templates.listTemplates({}).then((r) => r.templates) });
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim().slice(0, 200)), PAUSE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const searching = term.length >= MIN_SEARCH;
  // A Forge that cannot search the docs leaves the places alone.
  const docs = useQuery({
    queryKey: ["docsearch", "palette", term],
    queryFn: () => api.docs.searchDocs({ query: term, pageSize: DOC_RESULTS }),
    enabled: searching,
    staleTime: 30_000,
  });
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const places = filterJumps(jumpItems(services.data ?? [], previews.data ?? [], templates.data ?? []), query, searching ? 6 : 9);
  const docItems: JumpItem[] = searching
    ? [
        ...(docs.data?.results ?? []).map((r) => {
          const id = serviceId(r.service);
          return { label: r.title, href: docHref(id, r.path), kind: `Docs · ${id}`, mono: false, line: r.lines[0] ? plainLine(r.lines[0].text) : undefined };
        }),
        { label: `Search all docs for “${term}”`, href: `/docs?q=${encodeURIComponent(term)}`, kind: "Docs", mono: false },
      ]
    : [];
  const items = [...places, ...docItems];
  const current = Math.min(at, Math.max(items.length - 1, 0));
  const terms = searchTerms(term);

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

  const option = (item: JumpItem, i: number) => (
    <li
      key={`${item.kind}:${item.href}`}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === current}
      onMouseMove={() => setAt(i)}
      onClick={() => go(item.href)}
      className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 ${i === current ? "bg-surface-2" : ""}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className={item.mono ? "font-mono text-[13px]" : ""}>{item.line === undefined ? item.label : <Marked text={item.label} terms={terms} />}</span>
        {item.line ? (
          <span className="truncate text-[12.5px] text-fg-3">
            <Marked text={item.line} terms={terms} />
          </span>
        ) : null}
      </span>
      <span className="ml-auto shrink-0 pt-px text-[12px] text-fg-3">{item.kind}</span>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start bg-scrim p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="mx-auto mt-[calc(var(--vh)*0.12)] w-full max-w-[600px] overflow-hidden rounded-lg bg-surface shadow-3">
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
          aria-label="Jump to"
          autoComplete="off"
          spellCheck={false}
          placeholder="Jump to a service, template or page, or search the docs"
          maxLength={200}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={onKey}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] text-fg outline-none placeholder:text-fg-3"
        />
        <ul id={listId} role="listbox" aria-label="Places" className="max-h-[420px] overflow-y-auto p-1.5">
          {places.length === 0 && !searching ? <li className="px-4 py-3.5 text-fg-3">Nothing matches. Try a service name.</li> : null}
          {places.map((item, i) => option(item, i))}
          {searching ? (
            <li role="presentation" className="flex items-center gap-2 px-2.5 pb-1 pt-2.5 text-[11px] uppercase tracking-[0.08em] text-fg-3">
              In the docs
              {docs.isFetching ? <span className="normal-case tracking-normal">· searching…</span> : null}
              {docs.data && docs.data.results.length === 0 ? <span className="normal-case tracking-normal">· no page holds all of the words</span> : null}
            </li>
          ) : null}
          {docItems.map((item, i) => option(item, places.length + i))}
        </ul>
      </div>
    </div>
  );
}
