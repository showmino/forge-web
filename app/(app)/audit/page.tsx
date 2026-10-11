"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { AuditTable } from "@/components/audit-table";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";

type Filters = { service: string; actor: string; action: string; failedOnly: boolean };
const NONE: Filters = { service: "", actor: "", action: "", failedOnly: false };

const input =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] text-fg placeholder:text-fg-3";
const label = "text-[13px] font-medium";

// The audit log: who did what to which service, and how it ended. The filters
// are the CLI's own, so the command under the title always matches the table.
export default function AuditLog() {
  const api = useApi();
  const [draft, setDraft] = useState<Filters>(NONE);
  const [filters, setFilters] = useState<Filters>(NONE);

  // A link such as /audit?service=payments opens the log already filtered.
  useEffect(() => {
    const service = new URLSearchParams(window.location.search).get("service");
    if (!service) return;
    // The address is only known in the browser, after the page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((d) => ({ ...d, service }));
    setFilters((f) => ({ ...f, service }));
  }, []);

  const events = useInfiniteQuery({
    queryKey: ["audit", filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api.audit.listAuditEvents({ ...filters, pageSize: 50, pageToken: pageParam }),
    getNextPageParam: (last) => last.nextPageToken || undefined,
  });
  const all = events.data?.pages.flatMap((p) => p.events) ?? [];
  const filtered = !!(filters.service || filters.actor || filters.action || filters.failedOnly);

  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters({ ...draft, service: draft.service.trim(), actor: draft.actor.trim(), action: draft.action.trim() });
  }
  function clear() {
    setDraft(NONE);
    setFilters(NONE);
  }

  const cli = [
    "forge audit list",
    filters.service && `--service ${filters.service}`,
    filters.actor && `--actor ${filters.actor}`,
    filters.action && `--action ${filters.action}`,
    filters.failedOnly && "--failed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <PageHeader title="Audit log" lead="Every platform action, from the CLI, the console or CI, and how it ended. Newest first." cli={cli} />
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <label className="flex w-44 flex-col gap-1.5">
          <span className={label}>Service</span>
          <input
            id="audit-service"
            className={`${input} font-mono`}
            value={draft.service}
            onChange={(e) => setDraft({ ...draft, service: e.target.value })}
            placeholder="payments"
          />
        </label>
        <label className="flex w-56 flex-col gap-1.5">
          <span className={label}>Who</span>
          <input
            id="audit-actor"
            className={input}
            value={draft.actor}
            onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
            placeholder="Email or repository"
          />
        </label>
        <label className="flex w-44 flex-col gap-1.5">
          <span className={label}>Action</span>
          <input
            id="audit-action"
            className={`${input} font-mono`}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            placeholder="deploy.promote"
          />
        </label>
        <label className="flex items-center gap-2 py-[7px] text-[13.5px]">
          <input
            id="audit-failed"
            type="checkbox"
            className="size-4 accent-ember"
            checked={draft.failedOnly}
            onChange={(e) => setDraft({ ...draft, failedOnly: e.target.checked })}
          />
          Failed only
        </label>
        <Button type="submit">Apply filters</Button>
        {filtered ? (
          <Button kind="quiet" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </form>

      {events.isPending ? (
        <Loading what="the audit log" />
      ) : events.error ? (
        <ErrorNote error={events.error} />
      ) : all.length === 0 ? (
        <Empty>{filtered ? "No event matches these filters." : "Nothing has been recorded yet."}</Empty>
      ) : (
        <>
          <AuditTable events={all} />
          {events.hasNextPage ? (
            <div>
              <Button onClick={() => void events.fetchNextPage()} disabled={events.isFetchingNextPage}>
                {events.isFetchingNextPage ? "Loading older events" : "Show older events"}
              </Button>
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-3">
              {all.length} {all.length === 1 ? "event" : "events"} shown.
            </p>
          )}
        </>
      )}
    </>
  );
}
