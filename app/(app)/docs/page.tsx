"use client";

import { Code } from "@connectrpc/connect";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { useApi } from "@/components/providers";
import { NameLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, Panel, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Marked } from "@/components/ui/marked";
import type { DocSearchResult } from "@/gen/forge/v1/docs_pb";
import { isCode, serviceId } from "@/lib/api";
import { docHref, plainLine, searchTerms, START } from "@/lib/docs";
import { when } from "@/lib/format";

// Searches start once the reader has typed this much, and has stopped for a moment.
const MIN_SEARCH = 2;
const PAUSE_MS = 250;

// Every service that has docs: Markdown under docs/ in its repo, read by
// Forge from the default branch. One box narrows the services by name or
// team and searches the pages of all of them.
export default function Docs() {
  const api = useApi();
  // ?q= starts with a search, as the command palette's "Search all docs" does.
  const asked = useSearchParams().get("q")?.slice(0, 200) ?? "";
  const [text, setText] = useState(asked);
  const [query, setQuery] = useState(asked.trim());
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
        lead="Every service's documentation in one place, read straight from its repo: what it does, how to run it, what to do when it breaks."
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
          {searching ? null : <HowDocsWork />}
          {searching && shown.length > 0 ? <h2 className="type-heading mt-2">Services</h2> : null}
          {shown.length === 0 ? (
            searching ? null : <p className="text-fg-3">No docs match. Clear the search.</p>
          ) : (
            <>
              <TableFrame label="Docs">
                <thead>
                  <tr>
                    <th className={th}>Service</th>
                    <th className={th}>Team</th>
                    <th className={th}>Pages</th>
                    <th className={th}>Changed</th>
                    <th className={`${th} relative`}>
                      <span className="sr-only">Read</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => {
                    const id = serviceId(d.service);
                    return (
                      <tr key={d.service} className={tr}>
                        <td className={td}>
                          <NameLink href={docHref(id, START)}>{id}</NameLink>
                        </td>
                        <td className={`${td} text-fg-2`}>{d.ownerTeam || "–"}</td>
                        <td className={`${td} text-fg-2`}>{d.pageCount}</td>
                        <td className={`${td} text-fg-2`}>{when(d.changeTime)}</td>
                        <td className={`${td} w-0 text-right`}>
                          <Link href={docHref(id, START)} className="text-[13px] text-info-fg no-underline hover:underline" aria-label={`Read the docs of ${id}`}>
                            Read →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableFrame>
              <p className="text-[12.5px] text-fg-3">
                {shown.length === sets.data.length
                  ? `${sets.data.length} ${sets.data.length === 1 ? "service has" : "services have"} docs.`
                  : `${shown.length} of ${sets.data.length} services with docs shown.`}
              </p>
            </>
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
                            <Marked text={plainLine(l.text)} terms={terms} />
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

// HowDocsWork says, in three steps, how a service gets docs here.
function HowDocsWork() {
  const code = "font-mono text-[12.5px] text-fg";
  const steps: [title: string, body: ReactNode][] = [
    [
      "Write",
      <>
        Markdown under <span className={code}>docs/</span> in the service&apos;s repo, next to the code.{" "}
        <span className={code}>docs/index.md</span> is the start page. Tables, code, images and{" "}
        <span className={code}>mermaid</span> diagrams work.
      </>,
    ],
    [
      "Merge",
      <>Forge reads the default branch as it is: a merged change shows here, and in search, within a minute. Nothing to build or publish.</>,
    ],
    [
      "Check",
      <>
        <span className={code}>forge docs lint</span> in the repo finds broken links and missing pages before a push. A{" "}
        <span className={code}>docs:</span> list in forge.yaml sets the order and titles.
      </>,
    ],
  ];
  return (
    <Panel className="p-0">
      <section aria-label="How docs work" className="grid grid-cols-1 min-[861px]:grid-cols-3">
        {steps.map(([title, body], i) => (
          <div key={title} className="flex gap-3 border-line px-5 py-4 [&:not(:first-child)]:border-t min-[861px]:[&:not(:first-child)]:border-l min-[861px]:[&:not(:first-child)]:border-t-0">
            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ember-soft font-mono text-[12px] font-semibold text-ember-ink">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="type-body-strong">{title}</h2>
              <p className="text-[13px] leading-[1.55] text-fg-2">{body}</p>
            </div>
          </div>
        ))}
      </section>
    </Panel>
  );
}
