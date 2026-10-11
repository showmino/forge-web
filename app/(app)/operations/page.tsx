"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "@/components/providers";
import { TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import { operationId } from "@/lib/api";
import { exact, when } from "@/lib/format";
import { operationStatus, operationTitle } from "@/lib/status";

// Long-running work, newest first: deploys, promotions, rollbacks and previews.
export default function Operations() {
  const api = useApi();
  const [runningOnly, setRunningOnly] = useState(false);
  const operations = useQuery({
    queryKey: ["operations", { runningOnly }],
    queryFn: () => api.operations.listOperations({ running: runningOnly }).then((r) => r.operations),
    // Running work changes by itself: look again while the page is open.
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader title="Operations" lead="Deploys, promotions, rollbacks and previews as they run. Forge forgets them when it restarts; the audit log keeps the outcome.">
        <label className="flex h-8 items-center gap-2">
          <input
            id="operations-running"
            type="checkbox"
            className="size-4 accent-accent"
            checked={runningOnly}
            onChange={(e) => setRunningOnly(e.target.checked)}
          />
          Running only
        </label>
      </PageHeader>
      {operations.isPending ? (
        <Loading what="operations" />
      ) : operations.error ? (
        <ErrorNote error={operations.error} />
      ) : operations.data.length === 0 ? (
        <Empty>{runningOnly ? "Nothing is running." : "No operations since Forge last started."}</Empty>
      ) : (
        <TableFrame label="Operations">
          <thead>
            <tr>
              <th className={th}>Operation</th>
              <th className={th}>What</th>
              <th className={th}>Status</th>
              <th className={th}>Started</th>
              <th className={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {operations.data.map((op) => (
              <tr key={op.name} className={tr}>
                <td className={td}>
                  <TextLink href={`/operations/${operationId(op.name)}`} className="type-code">
                    {operationId(op.name)}
                  </TextLink>
                </td>
                <td className={td}>{operationTitle(op)}</td>
                <td className={td}>
                  <StatusBadge status={operationStatus(op)} title={op.error?.message || undefined} />
                </td>
                <td className={`${td} text-ink-muted`} title={exact(op.createTime)}>
                  {when(op.createTime)}
                </td>
                <td className={td}>{op.creator || "–"}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </>
  );
}
