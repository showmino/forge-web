"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApi } from "@/components/providers";
import { NameLink, TextLink } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/chips";
import { ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { MiniLine } from "@/components/ui/pipeline";
import { EnvTag, StatusBadge, Tag } from "@/components/ui/status";
import { listAuditSince, operationId } from "@/lib/api";
import { type DeployFilter, deployRows, matchesDeploy } from "@/lib/deployments";
import { timeAgo } from "@/lib/format";
import { recentDeploys, STAGES } from "@/lib/overview";
import type { Status } from "@/lib/status";

const WEEK_MS = 7 * 24 * 3600_000;
// A week of deploys fits in a few pages of the audit log.
const PAGES = 10;

const filters: { value: DeployFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "In progress" },
  { value: "failed", label: "Failed" },
  { value: "succeeded", label: "Succeeded" },
];

const ended: Record<string, Status> = {
  running: { tone: "progress", word: "In progress" },
  succeeded: { tone: "success", word: "Succeeded" },
  failed: { tone: "danger", word: "Failed" },
  cancelled: { tone: "neutral", word: "Cancelled" },
};
const kindWord = { deploy: "Deploy", promote: "Promotion", rollback: "Rollback" };

function command(f: DeployFilter): string {
  if (f === "running") return "forge op list --running";
  return f === "failed" ? "forge audit list --since 7d --failed" : "forge audit list --since 7d";
}

// Deploys, promotions and rollbacks: the ones running now and the ones that
// ended in the last 7 days.
export default function Deployments() {
  const api = useApi();
  const [filter, setFilter] = useState<DeployFilter>("all");
  const running = useQuery({
    queryKey: ["operations", "running"],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
    refetchInterval: 5_000,
  });
  const audit = useQuery({ queryKey: ["audit", "week"], queryFn: () => listAuditSince(api, WEEK_MS, PAGES), refetchInterval: 30_000 });
  const rows = useMemo(() => deployRows(running.data ?? [], recentDeploys(audit.data ?? [])), [running.data, audit.data]);
  const shown = rows.filter((r) => matchesDeploy(r, filter));

  return (
    <>
      <PageHeader
        title="Deployments"
        lead="Deploys, promotions and rollbacks of the last 7 days. Argo CD syncs each one; a deploy that does not become healthy fails."
        cli={command(filter)}
      />
      {audit.isPending ? (
        <Loading what="deployments" />
      ) : audit.error ? (
        <ErrorNote error={audit.error} />
      ) : (
        <>
          <FilterChips options={filters.map((f) => ({ ...f, count: rows.filter((r) => matchesDeploy(r, f.value)).length }))} value={filter} onChange={setFilter} />
          {running.error ? <ErrorNote error={running.error} /> : null}
          <TableFrame label="Deployments">
            <thead>
              <tr>
                <th className={th}>Service</th>
                <th className={th}>Ref</th>
                <th className={th}>Environment</th>
                <th className={th}>Pipeline</th>
                <th className={th}>Status</th>
                <th className={th}>By</th>
                <th className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className={`${td} text-fg-3`}>
                    {rows.length === 0 ? "No deploys in the last 7 days." : "No deployments match this filter."}
                  </td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.key} className={tr}>
                  <td className={td}>
                    <NameLink href={`/services/${r.service}`}>{r.service}</NameLink>
                    <div className="max-w-[300px] whitespace-normal text-[12.5px] text-fg-3">
                      {kindWord[r.kind]}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                  </td>
                  <td className={td}>{r.ref ? <Tag>{r.ref}</Tag> : <span className="text-fg-3">–</span>}</td>
                  <td className={td}>
                    <EnvTag kind={r.env === "production" ? "production" : r.env === "staging" ? "staging" : "preview"} name={r.env} />
                  </td>
                  <td className={td}>
                    <MiniLine pipeline={r.pipeline} /> <span className="text-[12px] text-fg-3">{STAGES[r.pipeline.stage]}</span>
                  </td>
                  <td className={td}>
                    {r.running ? (
                      <TextLink href={`/operations/${operationId(r.operation)}`} aria-label={`Watch ${operationId(r.operation)}`}>
                        <StatusBadge status={ended.running} />
                      </TextLink>
                    ) : (
                      <StatusBadge status={ended[r.pipeline.state]} />
                    )}
                  </td>
                  <td className={`${td} font-mono text-[12.5px]`}>{r.by}</td>
                  <td className={`${td} text-fg-3`} title={r.time?.toISOString()}>
                    {r.time ? timeAgo(r.time) : "–"}
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
