"use client";

import { timestampNow } from "@bufbuild/protobuf/wkt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCanWrite } from "@/components/app-shell";
import { StepLog, type Step, useOperation } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { ExtendDialog } from "@/components/service-actions";
import { Button, ButtonLink, Icon, TextLink } from "@/components/ui/button";
import { ErrorNote, Loading, PageHeader, Panel, Section } from "@/components/ui/layout";
import { MiniLine, StageLine, Stats } from "@/components/ui/pipeline";
import { StatusBadge, Tag } from "@/components/ui/status";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import type { Operation } from "@/gen/forge/v1/operation_pb";
import { type Api, listAllServices, operationId } from "@/lib/api";
import { timeAgo, when } from "@/lib/format";
import { attention, dayStats, deployKind, pipelineOf, recentDeploys, shipping, type Attention, type RecentDeploy } from "@/lib/overview";
import { operationTitle, type Status, type Tone } from "@/lib/status";

const DAY_MS = 24 * 3600_000;
// The audit log is read a page at a time; a day of deploys fits in a few.
const PAGES = 5;

// lastDay reads the audit log of the last 24 hours, newest first. That always
// covers today, and it outlives a restart of the API, which a list of
// operations does not.
async function lastDay(api: Api): Promise<AuditEvent[]> {
  const since = timestampNow();
  since.seconds -= BigInt(DAY_MS / 1000);
  const events: AuditEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < PAGES; page++) {
    const res = await api.audit.listAuditEvents({ since, pageSize: 200, pageToken });
    events.push(...res.events);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

const mono = "font-mono text-[0.92em] font-medium";

// Overview: what is shipping, what is broken and what needs someone, from
// what the API already knows.
export default function Overview() {
  const api = useApi();
  const canWrite = useCanWrite();
  const queries = useQueryClient();
  const [extending, setExtending] = useState<Environment | null>(null);

  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
    refetchInterval: 30_000,
  });
  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: () => api.environments.listEnvironments({}).then((r) => r.environments),
    refetchInterval: 30_000,
  });
  const running = useQuery({
    queryKey: ["operations", "running"],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
    refetchInterval: 5_000,
  });
  const audit = useQuery({ queryKey: ["audit", "last-day"], queryFn: () => lastDay(api), refetchInterval: 30_000 });

  const recent = useMemo(() => recentDeploys(audit.data ?? []), [audit.data]);
  const stats = useMemo(() => dayStats(audit.data ?? []), [audit.data]);
  const needs = useMemo(
    () => attention(deployments.data ?? [], environments.data ?? [], recent),
    [deployments.data, environments.data, recent],
  );

  // When something in flight lands, everything it touched is read again.
  function landed() {
    for (const key of ["operations", "audit", "deployments", "environments"]) void queries.invalidateQueries({ queryKey: [key] });
  }

  const number = (q: { isPending: boolean; error: unknown }, n: number) => (q.isPending ? "…" : q.error ? "–" : n);
  const broken = deployments.error ?? environments.error ?? audit.error;

  return (
    <>
      <PageHeader
        title="Overview"
        lead="What is shipping, what is broken and what needs you, in staging and production."
        cli="forge deploy status"
      >
        {canWrite ? (
          <ButtonLink kind="primary" href="/create">
            <Icon name="plus" />
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>

      <Stats
        items={[
          { label: "Services in the catalog", value: number(services, services.data?.length ?? 0) },
          { label: "Deploys today", value: number(audit, stats.started) },
          { label: "Finished deploys that failed", value: number(audit, stats.failed), of: audit.data ? stats.finished : undefined },
          { label: "Preview environments live", value: number(environments, environments.data?.length ?? 0) },
        ]}
      />

      {running.data && running.data.length > 0 ? (
        <Section title="In flight" action={<TextLink href="/operations">All operations</TextLink>}>
          {running.data.slice(0, 3).map((op) => (
            <Flight key={op.name} op={op} onLanded={landed} />
          ))}
          {running.data.length > 3 ? (
            <p className="text-[13px] text-fg-3">
              And {running.data.length - 3} more. <TextLink href="/operations">See them all</TextLink>
            </p>
          ) : null}
        </Section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 min-[1081px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Section title="Needs attention" note={broken || deployments.isPending ? undefined : needs.length}>
          {broken ? (
            <ErrorNote error={broken} />
          ) : deployments.isPending || environments.isPending || audit.isPending ? (
            <Loading what="what needs attention" />
          ) : needs.length === 0 ? (
            <Panel className="p-6 text-center text-[13.5px] text-fg-2">Nothing needs you right now.</Panel>
          ) : (
            <Panel>
              <ul aria-label="Needs attention">
                {needs.map((a) => (
                  <AttentionRow key={a.key} item={a} canWrite={canWrite} onExtend={setExtending} />
                ))}
              </ul>
            </Panel>
          )}
        </Section>

        <Section title="Recent deploys" action={<TextLink href="/audit">History</TextLink>}>
          {audit.error ? (
            <ErrorNote error={audit.error} />
          ) : audit.isPending ? (
            <Loading what="recent deploys" />
          ) : recent.length === 0 ? (
            <Panel className="p-6 text-center text-[13.5px] text-fg-2">No deploy has ended in the last 24 hours.</Panel>
          ) : (
            <Panel>
              <ul aria-label="Recent deploys">
                {recent.slice(0, 6).map((r) => (
                  <RecentRow key={r.key} deploy={r} />
                ))}
              </ul>
            </Panel>
          )}
        </Section>
      </div>

      {extending ? (
        <ExtendDialog
          environment={extending}
          onClose={() => setExtending(null)}
          onStarted={() => {
            setExtending(null);
            void queries.invalidateQueries({ queryKey: ["environments"] });
          }}
        />
      ) : null}
    </>
  );
}

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0";

function AttentionRow({ item, canWrite, onExtend }: { item: Attention; canWrite: boolean; onExtend: (e: Environment) => void }) {
  return (
    <li className={row}>
      <span aria-hidden="true" className={`w-[3px] self-stretch rounded-[2px] ${item.tone === "danger" ? "bg-bad-dot" : "bg-warn-dot"}`} />
      <div className="min-w-0">
        <div className="font-medium">
          {item.before}
          <span className={mono}>{item.subject}</span>
          {item.after}
        </div>
        <div className="mt-px break-words text-[12.5px] text-fg-3">{item.detail}</div>
      </div>
      {item.extend && canWrite ? (
        <Button size="sm" onClick={() => onExtend(item.extend!)} aria-label={`Extend ${item.subject}`}>
          Extend
        </Button>
      ) : (
        <ButtonLink size="sm" href={item.href} aria-label={`Open ${item.subject}`}>
          Open
        </ButtonLink>
      )}
    </li>
  );
}

const ended: Record<RecentDeploy["pipeline"]["state"], Status> = {
  succeeded: { tone: "success", word: "Succeeded" },
  failed: { tone: "danger", word: "Failed" },
  cancelled: { tone: "neutral", word: "Cancelled" },
  running: { tone: "progress", word: "In progress" },
};
const kindWord = { deploy: "Deploy", promote: "Promotion", rollback: "Rollback" };

function RecentRow({ deploy }: { deploy: RecentDeploy }) {
  return (
    <li className={row}>
      <MiniLine pipeline={deploy.pipeline} />
      <div className="min-w-0">
        <div className="font-medium">
          <TextLink href={`/services/${deploy.service}`} className={`${mono} !text-fg no-underline hover:underline`}>
            {deploy.service}
          </TextLink>{" "}
          <span className="text-fg-3">→ {deploy.env}</span>
        </div>
        <div className="mt-px break-words text-[12.5px] text-fg-3">
          {kindWord[deploy.kind]}
          {deploy.note ? ` · ${deploy.note}` : ""}
          {deploy.time ? ` · ${timeAgo(deploy.time)}` : ""}
        </div>
      </div>
      <StatusBadge status={ended[deploy.pipeline.state]} />
    </li>
  );
}

// Flight is one operation that is running, followed live.
function Flight({ op, onLanded }: { op: Operation; onLanded: () => void }) {
  const { events, operation } = useOperation(op.name);
  const current = operation ?? op;
  const kind = deployKind(op.kind);
  const where = /^deployments\/([^/]+)\/([^/]+)$/.exec(op.target);
  const id = operationId(op.name);
  const ships = shipping(events);

  useEffect(() => {
    if (operation?.done) onLanded();
    // onLanded changes with every render of the page; the end of the operation is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation?.done]);

  const steps: Step[] = events.slice(-5).map((e, i, shown) => {
    const tone: Tone = i === shown.length - 1 && !current.done ? "progress" : "success";
    return { key: `${events.length - shown.length + i}`, time: e.time, tone, text: e.message || e.step };
  });

  return (
    <Panel className="flex flex-col gap-4 p-6">
      <section aria-label={`In flight: ${operationTitle(op)}`} className="contents">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-mono text-[16px] font-semibold">
            {where ? (
              <>
                {where[1]} <span className="text-fg-3">→</span> {where[2]}
              </>
            ) : (
              operationTitle(op)
            )}
          </span>
          <StatusBadge status={current.done ? ended[pipelineOf(current, events).state] : { tone: "progress", word: "In progress" }} />
          {ships ? <Tag>{ships}</Tag> : null}
          <ButtonLink size="sm" href={`/operations/${id}`} className="ml-auto" aria-label={`Watch ${id}`}>
            Watch
          </ButtonLink>
        </div>
        {kind ? <StageLine pipeline={pipelineOf(current, events)} /> : null}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-fg-2">
          <span>
            Started by <span className={mono}>{op.creator || "unknown"}</span> {when(op.createTime)}
          </span>
          <span>
            Operation <span className={mono}>{id}</span>
          </span>
          {where ? (
            <span>
              Argo CD app{" "}
              <span className={mono}>
                {where[1]}-{where[2]}
              </span>
            </span>
          ) : null}
        </div>
        {steps.length > 0 ? (
          <div className="rounded-md bg-surface-2 text-[13px]">
            <StepLog steps={steps} />
          </div>
        ) : null}
      </section>
    </Panel>
  );
}
