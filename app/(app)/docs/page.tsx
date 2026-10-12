"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/providers";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { serviceId } from "@/lib/api";
import { docHref, START } from "@/lib/docs";
import { when } from "@/lib/format";

// Every service that has docs: Markdown under docs/ in its repo, read by
// Forge from the default branch.
export default function Docs() {
  const api = useApi();
  const [filter, setFilter] = useState("");
  const sets = useQuery({ queryKey: ["docsets"], queryFn: () => api.docs.listDocSets({}).then((r) => r.docSets) });
  const needle = filter.trim().toLowerCase();
  const shown = (sets.data ?? []).filter((d) => !needle || `${serviceId(d.service)} ${d.ownerTeam}`.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader
        title="Docs"
        lead="Docs live in each service's repo, next to the code, under docs/. Forge reads them from the default branch: a change shows here within a minute of its merge."
        cli="forge docs list"
      />
      {sets.isPending ? (
        <Loading what="the docs" />
      ) : sets.error ? (
        <ErrorNote error={sets.error} />
      ) : sets.data.length === 0 ? (
        <Empty>
          No service has docs yet. Add <span className="font-mono text-[12.5px]">docs/index.md</span> to a service&apos;s repo.
        </Empty>
      ) : (
        <>
          <div>
            <label htmlFor="docs-filter" className="sr-only">
              Filter docs
            </label>
            <input
              id="docs-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Service or team"
              className="w-full max-w-[260px] rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] text-fg placeholder:text-fg-3"
            />
          </div>
          {shown.length === 0 ? (
            <p className="text-fg-3">No docs match. Clear the filter.</p>
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
