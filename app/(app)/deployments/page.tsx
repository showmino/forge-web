"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useWaitingApprovals } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { ButtonLink, NameLink, TextLink } from "@/components/ui/button";
import { ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { MiniLine } from "@/components/ui/pipeline";
import { btd, bth, Card, CardNote, Choose, ct, Find, FilterBar, Mark, PageTabs, Stat, Stats, wide } from "@/components/ui/portal";
import { EnvTag, StatusBadge, Tag } from "@/components/ui/status";
import { listAuditSince, operationId } from "@/lib/api";
import { type DeployFilter, type DeployRow, deployRows, durations, durationText, matchesDeploy, median, searchDeploys } from "@/lib/deployments";
import { timeAgo } from "@/lib/format";
import { dayStats, recentDeploys, STAGES } from "@/lib/overview";
import type { Status } from "@/lib/status";

const WEEK_MS = 7 * 24 * 3600_000;
// A week of deploys fits in a few pages of the audit log.
const PAGES = 10;

const ended: Record<string, Status> = {
  running: { tone: "progress", word: "In progress" },
  succeeded: { tone: "success", word: "Succeeded" },
  failed: { tone: "danger", word: "Failed" },
  cancelled: { tone: "neutral", word: "Cancelled" },
};
const kindWord = { deploy: "Deploy", promote: "Promotion", rollback: "Rollback" };
const mark = { running: "bg-ember-soft text-ember-ink", succeeded: "bg-ok-dot text-on-bad", failed: "bg-bad-dot text-on-bad", cancelled: "bg-surface-2 text-fg-3" };

function command(f: DeployFilter): string {
  if (f === "running") return "forge op list --running";
  return f === "failed" ? "forge audit list --since 7d --failed" : "forge audit list --since 7d";
}

const envKind = (env: string) => (env === "production" ? "production" : env === "staging" ? "staging" : "preview");

// Deployments: the day in four numbers, then every deploy, promotion and
// rollback running now or ended in the last 7 days, with search and filters,
// and the details of the one picked.
export default function Deployments() {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [service, setService] = useState("all");
  const [env, setEnv] = useState("all");
  const [state, setState] = useState<DeployFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const waiting = useWaitingApprovals();

  const running = useQuery({
    queryKey: ["operations", "running"],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
    refetchInterval: 5_000,
  });
  const audit = useQuery({ queryKey: ["audit", "week"], queryFn: () => listAuditSince(api, WEEK_MS, PAGES), refetchInterval: 30_000 });
  const deployments = useQuery({ queryKey: ["deployments"], queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments) });

  const rows = useMemo(() => deployRows(running.data ?? [], recentDeploys(audit.data ?? [])), [running.data, audit.data]);
  const took = useMemo(() => durations(audit.data ?? []), [audit.data]);
  const day = useMemo(() => dayStats(audit.data ?? []), [audit.data]);
  const shown = searchDeploys(rows, { query, service, env, state });
  const selected = shown.find((r) => r.key === picked) ?? shown[0];
  const services = [...new Set(rows.map((r) => r.service))].sort();
  const live = rows.filter((r) => matchesDeploy(r, "running")).length;
  const okPct = day.finished ? Math.round((100 * (day.finished - day.failed)) / day.finished) : 100;
  const argo = (r: DeployRow) => deployments.data?.find((d) => d.name === `deployments/${r.service}/${r.env}`)?.argoUrl;

  return (
    <>
      <PageHeader
        title="Deployments"
        lead="Build and deploy changes across your environments. Argo CD syncs each one; a deploy that does not become healthy fails."
        cli={command(state)}
      />
      <div className="flex flex-col gap-4">
        <PageTabs
          label="Deployments"
          tabs={[
            { label: "Activity", href: "/deployments", current: true },
            { label: "Approvals", href: "/approvals", count: waiting.length || undefined },
            { label: "Operations", href: "/operations" },
            { label: "History", href: "/audit" },
          ]}
        />

        {audit.isPending ? (
          <Loading what="deployments" />
        ) : audit.error ? (
          <ErrorNote error={audit.error} />
        ) : (
          <>
            <Stats label="Today">
              <Stat icon="rocket" label="Deployments today" value={day.started} chip={live ? `${live} running` : undefined} tone="progress" />
              <Stat
                icon="gauge"
                label="Success rate"
                value={
                  <>
                    {okPct}
                    <small className="ml-px text-[16px] font-semibold">%</small>
                  </>
                }
                chip={`${day.finished - day.failed} of ${day.finished} finished`}
                tone={okPct >= 90 ? "success" : okPct >= 70 ? "warning" : "danger"}
              />
              <Stat icon="pulse" label="Median duration" value={durationText(median(rows, took))} chip="successful deploys" />
              <Stat icon="bell" label="Failed deployments" value={day.failed} chip={day.failed ? "today" : "none today"} tone={day.failed ? "danger" : "success"} />
            </Stats>

            <FilterBar label="Filter deployments">
              <Find label="Search deployments…" value={query} onChange={setQuery} />
              <Choose label="Service" value={service} onChange={setService} options={[["all", "All"], ...services.map((s): [string, string] => [s, s])]} />
              <Choose
                label="Environment"
                value={env}
                onChange={setEnv}
                options={[
                  ["all", "All"],
                  ["production", "production"],
                  ["staging", "staging"],
                  ["preview", "previews"],
                ]}
              />
              <Choose
                label="Status"
                value={state}
                onChange={(v) => setState(v as DeployFilter)}
                options={[
                  ["all", "All"],
                  ["running", "In progress"],
                  ["succeeded", "Succeeded"],
                  ["failed", "Failed"],
                ]}
              />
            </FilterBar>
            {running.error ? <ErrorNote error={running.error} /> : null}

            <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4 max-[1100px]:grid-cols-1">
              <Card flush>
                <div className="overflow-x-auto">
                  <table aria-label="Deployments" className={ct}>
                    <thead>
                      <tr>
                        <th className={bth}>Deployment</th>
                        <th className={bth}>Service</th>
                        <th className={`${bth} ${wide}`}>Environment</th>
                        <th className={bth}>Status</th>
                        <th className={`${bth} ${wide}`}>Duration</th>
                        <th className={`${bth} ${wide}`}>By</th>
                        <th className={`${bth} ${wide}`}>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 ? (
                        <tr>
                          <td colSpan={7} className={`${btd} text-fg-3`}>
                            {rows.length === 0 ? "No deploys in the last 7 days." : "No deployments match this filter."}
                          </td>
                        </tr>
                      ) : null}
                      {shown.map((r) => {
                        const on = selected?.key === r.key;
                        return (
                          <tr
                            key={r.key}
                            aria-selected={on}
                            tabIndex={0}
                            onClick={() => setPicked(r.key)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setPicked(r.key);
                              }
                            }}
                            className={`cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ember ${
                              on ? "[&>td]:bg-ember-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--ember)]" : "hover:[&>td]:bg-surface-2"
                            }`}
                          >
                            <td className={btd}>
                              <span className="inline-flex items-center gap-2.5">
                                <span className={`grid size-6 flex-none place-items-center rounded-full ${mark[r.running ? "running" : r.pipeline.state]}`}>
                                  <Mark name={r.pipeline.state === "succeeded" ? "check" : r.pipeline.state === "failed" ? "cross" : "ship"} size={12} />
                                </span>
                                <span className="flex flex-col gap-px">
                                  {r.ref ? <Tag>{r.ref}</Tag> : <span className="text-fg-3">–</span>}
                                  <span className="text-[12px] text-fg-3">{kindWord[r.kind]}</span>
                                </span>
                              </span>
                            </td>
                            <td className={btd}>
                              <NameLink href={`/services/${r.service}`} onClick={(e) => e.stopPropagation()}>
                                {r.service}
                              </NameLink>
                            </td>
                            <td className={`${btd} ${wide}`}>
                              <EnvTag kind={envKind(r.env)} name={r.env} />
                            </td>
                            <td className={btd}>
                              {r.running ? (
                                <TextLink href={`/operations/${operationId(r.operation)}`} aria-label={`Watch ${operationId(r.operation)}`} onClick={(e) => e.stopPropagation()}>
                                  <StatusBadge status={ended.running} />
                                </TextLink>
                              ) : (
                                <StatusBadge status={ended[r.pipeline.state]} />
                              )}
                            </td>
                            <td className={`${btd} ${wide} text-fg-3`}>{r.running ? "…" : durationText(took.get(r.operation))}</td>
                            <td className={`${btd} ${wide} font-mono text-[12.5px]`}>{r.by}</td>
                            <td className={`${btd} ${wide} text-fg-3`} title={r.time?.toISOString()}>
                              {r.time ? timeAgo(r.time) : "–"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Details row={selected} took={selected ? took.get(selected.operation) : undefined} argoUrl={selected ? argo(selected) : undefined} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Details is the picked deployment: what, where, by whom, how far it got, and where to look next.
function Details({ row: r, took, argoUrl }: { row: DeployRow | undefined; took: number | undefined; argoUrl: string | undefined }) {
  if (!r) {
    return (
      <Card icon="ship" title="Deployment details">
        <CardNote>Pick a deployment to see its details.</CardNote>
      </Card>
    );
  }
  const op = operationId(r.operation);
  const where = r.running
    ? `${STAGES[r.pipeline.stage]}, step ${r.pipeline.stage + 1} of ${STAGES.length}`
    : r.pipeline.state === "succeeded"
      ? `All ${STAGES.length} stages passed`
      : r.pipeline.state === "failed"
        ? `${STAGES[r.pipeline.stage]} failed`
        : "Cancelled";
  return (
    <section aria-label="Deployment details" className="sticky top-[76px] flex min-w-0 flex-col rounded-lg border border-line bg-surface px-5 pt-[18px] pb-4 shadow-1 max-[1100px]:static">
      <h2 className="m-0 mb-3 font-display text-[17px] font-[650] [font-stretch:104%]">Deployment details</h2>
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <span className="font-mono text-[20px] font-semibold">{r.ref || kindWord[r.kind]}</span>
        <StatusBadge status={r.running ? ended.running : ended[r.pipeline.state]} />
      </div>
      {r.note ? <CardNote top>{r.note}</CardNote> : null}
      <dl className="m-0 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-[9px] text-[13.5px]">
        <dt className="text-fg-3">Service</dt>
        <dd className="m-0">
          <NameLink href={`/services/${r.service}`}>{r.service}</NameLink>
        </dd>
        <dt className="text-fg-3">Environment</dt>
        <dd className="m-0">
          <EnvTag kind={envKind(r.env)} name={r.env} />
        </dd>
        <dt className="text-fg-3">Kind</dt>
        <dd className="m-0">{kindWord[r.kind]}</dd>
        <dt className="text-fg-3">Triggered by</dt>
        <dd className="m-0 break-words">{r.by}</dd>
        <dt className="text-fg-3">Started</dt>
        <dd className="m-0">{r.time ? timeAgo(r.time) : "–"}</dd>
        <dt className="text-fg-3">Duration</dt>
        <dd className="m-0">{r.running ? "Running" : durationText(took)}</dd>
        <dt className="text-fg-3">Operation</dt>
        <dd className="m-0 font-mono text-[12.5px]">{op || "–"}</dd>
        {argoUrl && /^https?:\/\//i.test(argoUrl) ? (
          <>
            <dt className="text-fg-3">Argo CD</dt>
            <dd className="m-0">
              <a href={argoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-[5px] text-[13px] text-info-fg no-underline hover:underline">
                <span className="font-mono text-[12.5px]">
                  {r.service}-{r.env}
                </span>
                <Mark name="ext" size={13} />
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="mt-4 mb-1 flex items-center gap-2.5 text-[13px] text-fg-2">
        <MiniLine pipeline={r.pipeline} />
        <span>{where}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:justify-center">
        {op ? <ButtonLink href={`/operations/${op}`}>View operation</ButtonLink> : null}
        <ButtonLink href={`/services/${r.service}`}>Open service</ButtonLink>
      </div>
    </section>
  );
}
