"use client";

import { Code } from "@connectrpc/connect";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/components/providers";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import type { DocSearchResult } from "@/gen/forge/v1/docs_pb";
import { isCode, serviceId } from "@/lib/api";
import { docHref, marked, searchTerms, START } from "@/lib/docs";
import { when } from "@/lib/format";

// Searches start once the reader has typed this much, and has stopped for a moment.
const MIN_SEARCH = 2;
const PAUSE_MS = 250;

// Every service that has docs: Markdown under docs/ in its repo, read by
// Forge from the default branch. One box narrows the services by name or
// team and searches the pages of all of them.
export default function Docs() {
  const api = useApi();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), PAUSE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const sets = useQuery({ queryKey: ["docsets"], queryFn: () => api.docs.listDocSets({}).then((r) => r.docSets) });
  const searching = query.length >= MIN_SEARCH;
  const found = useQuery({
    queryKey: ["docsearch", query],
    queryFn: () => api.docs.searchDocs({ query }),
    enabled: searching && !!sets.data?.length,
    staleTime: 30_000,
  });

  const needle = query.toLowerCase();
  const shown = (sets.data ?? []).filter((d) => !needle || `${serviceId(d.service)} ${d.ownerTeam}`.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader
        title="Docs"
        lead="Docs live in each service's repo, next to the code, under docs/. Forge reads them from the default branch: a change shows here within a minute of its merge."
        cli={searching ? `forge docs search ${query}` : "forge docs list"}
      />
      {sets.isPending ? (
        <Loading what="the docs" />
      ) : sets.error ? (
        <ErrorNote error={sets.error} />
      ) : sets.data.length === 0 ? (
        <Empty>
          No service has docs yet. Add <span className="font-mono text-[12.5px]">docs/index.md</span> to a service&apos;s repo, and it
          shows here within a minute of the merge.
        </Empty>
      ) : (
        <>
          <div role="search">
            <label htmlFor="docs-search" className="sr-only">
              Search the docs
            </label>
            <input
              id="docs-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search the docs, or a service or team"
              maxLength={200}
              className="w-full max-w-[420px] rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] text-fg placeholder:text-fg-3"
            />
          </div>
          {searching ? <SearchResults query={query} result={found} /> : null}
          {searching && shown.length > 0 ? <h2 className="type-heading mt-2">Services</h2> : null}
          {shown.length === 0 ? (
            searching ? null : <p className="text-fg-3">No docs match. Clear the search.</p>
          ) : (
            <ul aria-label="Docs" className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
              {shown.map((d) => {
                const id = serviceId(d.service);
                return (
                  <li key={d.service}>
                    <Link
                      href={docHref(id, START)}
                      className="flex h-full flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4 text-fg no-underline shadow-1 hover:border-line-strong"
                    >
                      <span className="font-mono text-[14.5px] font-semibold">{id}</span>
                      <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[12.5px] text-fg-3">
                        <span>
                          {d.pageCount} {d.pageCount === 1 ? "page" : "pages"}
                        </span>
                        {d.ownerTeam ? <span>{d.ownerTeam}</span> : null}
                        <span>Changed {when(d.changeTime)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function SearchResults({
  query,
  result,
}: {
  query: string;
  result: { isPending: boolean; error: Error | null; data?: { results: DocSearchResult[]; totalSize: number } };
}) {
  const terms = searchTerms(query);
  if (result.isPending) return <Loading what="the pages that match" />;
  if (result.error) {
    return isCode(result.error, Code.Unimplemented) ? (
      <p role="note" className="text-[13.5px] text-fg-2">
        This Forge API cannot search the pages yet. The services below are still narrowed by name and team.
      </p>
    ) : (
      <ErrorNote error={result.error} />
    );
  }
  const { results, totalSize } = result.data!;
  return (
    <section aria-label="Pages that match" className="flex flex-col gap-3">
      <h2 className="type-heading">Pages</h2>
      {results.length === 0 ? (
        <p className="text-fg-3">
          No page holds all of: <span className="font-medium text-fg-2">{terms.join(" ")}</span>. Try fewer words.
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {results.map((r) => {
            const id = serviceId(r.service);
            return (
              <li key={`${r.service}/${r.path}`}>
                <Link
                  href={docHref(id, r.path)}
                  className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3 text-fg no-underline shadow-1 hover:border-line-strong"
                >
                  <span className="text-[14.5px] font-semibold">
                    <Marked text={r.title} terms={terms} />
                  </span>
                  <span className="font-mono text-[12px] text-fg-3">
                    {id} · docs/{r.path}
                  </span>
                  {r.lines.length > 0 ? (
                    <span className="mt-1 flex flex-col gap-0.5">
                      {r.lines.map((l) => (
                        <span key={l.number} className="flex gap-2 text-[13px] text-fg-2">
                          <span className="w-8 shrink-0 text-right font-mono text-[11.5px] leading-[19px] text-fg-3">{l.number}</span>
                          <span className="min-w-0 break-words">
                            <Marked text={l.text} terms={terms} />
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {totalSize > results.length ? (
        <p className="text-[12.5px] text-fg-3">
          Showing {results.length} of {totalSize} pages. Add a word to narrow it.
        </p>
      ) : null}
    </section>
  );
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {marked(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-ember-soft px-0.5 text-ember-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
