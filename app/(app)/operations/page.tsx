"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "@/components/providers";
import { NameLink } from "@/components/ui/button";
import { ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import type { Operation } from "@/gen/forge/v1/operation_pb";
import { operationId } from "@/lib/api";
import { exact, when } from "@/lib/format";
import { operationStatus, operationTitle } from "@/lib/status";

type Filter = "all" | "running" | "failed" | "succeeded";
const filters: [Filter, string][] = [
  ["all", "All"],
  ["running", "In progress"],
  ["failed", "Failed"],
  ["succeeded", "Succeeded"],
];

function matches(op: Operation, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "running") return !op.done;
  if (f === "succeeded") return op.done && !op.error;
  // Cancelled work did not fail: it shows under All only.
  return op.done && !!op.error && op.error.code !== "cancelled";
}

const chip =
  "cursor-pointer rounded-full border px-[11px] py-1 text-[13px] aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-bg";
const chipOff = "border-line bg-surface text-fg-2 hover:border-fg-3 hover:text-fg";

// Long-running work, newest first: deploys, promotions, rollbacks and previews.
export default function Operations() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>("all");
  const operations = useQuery({
    queryKey: ["operations", "all"],
    queryFn: () => api.operations.listOperations({}).then((r) => r.operations),
    // Running work changes by itself: look again while the page is open.
    refetchInterval: 10_000,
  });
  const all = operations.data ?? [];
  const shown = all.filter((op) => matches(op, filter));

  return (
    <>
      <PageHeader
        title="Operations"
        lead="Deploys, promotions, rollbacks and previews as they run. Forge forgets them when it restarts; the audit log keeps the outcome."
        cli={filter === "running" ? "forge op list --running" : "forge op list"}
      />
      {operations.isPending ? (
        <Loading what="operations" />
      ) : operations.error ? (
        <ErrorNote error={operations.error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {filters.map(([f, label]) => (
              <button
                key={f}
                type="button"
                className={`${chip} ${filter === f ? "" : chipOff}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {label}{" "}
                <span className="font-mono text-[11.5px] opacity-80">{all.filter((op) => matches(op, f)).length}</span>
              </button>
            ))}
          </div>
          <TableFrame label="Operations">
            <thead>
              <tr>
                <th className={th}>Operation</th>
                <th className={th}>What</th>
                <th className={th}>Status</th>
                <th className={th}>By</th>
                <th className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className={`${td} text-fg-3`}>
                    {all.length === 0 ? "No operations since Forge last started." : "No operations match this filter."}
                  </td>
                </tr>
              ) : null}
              {shown.map((op) => (
                <tr key={op.name} className={tr}>
                  <td className={td}>
                    <NameLink href={`/operations/${operationId(op.name)}`}>{operationId(op.name)}</NameLink>
                  </td>
                  <td className={td}>
                    {operationTitle(op)}
                    {op.done && op.error && op.error.code !== "cancelled" && op.error.message ? (
                      <div className="max-w-[320px] whitespace-normal text-[12.5px] text-fg-3">{op.error.message}</div>
                    ) : null}
                  </td>
                  <td className={td}>
                    <StatusBadge status={operationStatus(op)} title={op.error?.message || undefined} />
                  </td>
                  <td className={`${td} font-mono text-[12.5px]`}>{op.creator || "–"}</td>
                  <td className={`${td} text-fg-3`} title={exact(op.createTime)}>
                    {when(op.createTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}
    </>
  );
}
