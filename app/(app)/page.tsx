"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/components/app-shell";
import { StepLog, type Step, useOperation } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { ExtendDialog } from "@/components/service-actions";
import { Button, ButtonLink, Icon, TextLink } from "@/components/ui/button";
import { ErrorNote, Loading, PageHeader, Panel, Widget } from "@/components/ui/layout";
import { MiniLine, StageLine } from "@/components/ui/pipeline";
import { StatusBadge, Tag } from "@/components/ui/status";
import type { Cluster } from "@/gen/forge/v1/cluster_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import type { Operation } from "@/gen/forge/v1/operation_pb";
import { lastDay, listAllServices, operationId, serviceId } from "@/lib/api";
import { clusterStatus } from "@/lib/cluster";
import { timeAgo, when } from "@/lib/format";
import {
  attention,
  board,
  type BoardRow,
  dayStats,
  type DayStats,
  deployKind,
  expiringSoon,
  pipelineOf,
  recentDeploys,
  shipping,
  type Attention,
  type RecentDeploy,
  type Tile,
} from "@/lib/overview";
import { operationTitle, type Status, type Tone } from "@/lib/status";


const mono = "font-mono text-[0.92em] font-medium";

// Overview: the status of staging and production first, then what is
// shipping, what is broken and what needs someone, from what the API already knows.
export default function Overview() {
  const api = useApi();
  const canCreate = usePermissions().can("service.create");
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
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api.clusters.listClusters({}).then((r) => r.clusters),
    refetchInterval: 60_000,
  });

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

  const broken = deployments.error ?? environments.error ?? audit.error;

  return (
    <>
      <PageHeader
        title="Overview"
        lead="What is shipping, what is broken and what needs you, in staging and production."
        cli="forge deploy status"
      >
        {canCreate ? (
          <ButtonLink kind="primary" href="/create">
            <Icon name="plus" />
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>

      <StatusBoard
        rows={deployments.data ? board(deployments.data, services.data?.length) : undefined}
        error={deployments.error}
        day={audit.data ? stats : audit.error ? "error" : undefined}
        previews={environments.data ? { live: environments.data.length, ending: expiringSoon(environments.data) } : environments.error ? "error" : undefined}
        clusters={clusters.data ?? (clusters.error ? "error" : undefined)}
      />

      {running.data && running.data.length > 0 ? (
        <Widget title="In flight" link={{ href: "/operations", label: "All operations" }}>
          <div className="flex flex-col gap-4">
            {running.data.slice(0, 3).map((op) => (
              <Flight key={op.name} op={op} onLanded={landed} />
            ))}
            {running.data.length > 3 ? (
              <p className="text-[13px] text-fg-3">
                And {running.data.length - 3} more. <TextLink href="/operations">See them all</TextLink>
              </p>
            ) : null}
          </div>
        </Widget>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 min-[1081px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Widget title="Needs attention" note={broken || deployments.isPending ? undefined : needs.length}>
          {broken ? (
            <ErrorNote error={broken} />
          ) : deployments.isPending || environments.isPending || audit.isPending ? (
            <Loading what="what needs attention" />
          ) : needs.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-fg-2">Nothing needs you right now.</p>
          ) : (
            <ul aria-label="Needs attention">
              {needs.map((a) => (
                <AttentionRow key={a.key} item={a} onExtend={setExtending} />
              ))}
            </ul>
          )}
        </Widget>

        <Widget title="Recent deploys" link={{ href: "/audit", label: "History" }}>
          {audit.error ? (
            <ErrorNote error={audit.error} />
          ) : audit.isPending ? (
            <Loading what="recent deploys" />
          ) : recent.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-fg-2">No deploy has ended in the last 24 hours.</p>
          ) : (
            <ul aria-label="Recent deploys">
              {recent.slice(0, 6).map((r) => (
                <RecentRow key={r.key} deploy={r} />
              ))}
            </ul>
          )}
        </Widget>
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

type Loaded<T> = T | "error" | undefined;

// StatusBoard is the head of the page: a row each for production and
// staging, one tile per service deployed there with what is broken first, and
// under them the day's deploys, the previews and the clusters.
function StatusBoard({
  rows,
  error,
  day,
  previews,
  clusters,
}: {
  rows: BoardRow[] | undefined;
  error: unknown;
  day: Loaded<DayStats>;
  previews: Loaded<{ live: number; ending: number }>;
  clusters: Loaded<Cluster[]>;
}) {
  const shown = <T,>(v: Loaded<T>, f: (v: T) => ReactNode) => (v === undefined ? "…" : v === "error" ? "–" : f(v));
  const needLook = Array.isArray(clusters) ? clusters.filter((c) => clusterStatus(c).tone !== "success").length : 0;
  return (
    <section aria-labelledby="status-board" className="min-w-0 rounded-lg border border-line bg-surface shadow-1">
      <div className="flex items-baseline gap-3 px-6 pt-4 pb-1 max-[700px]:px-4">
        <h2 id="status-board" className="text-[12px] font-semibold tracking-[.06em] text-fg-3 uppercase">
          Status
        </h2>
        <TextLink href="/environments" className="ml-auto text-[12.5px] text-fg-2">
          Environments
        </TextLink>
      </div>
      {error ? (
        <div className="px-6 pb-4">
          <ErrorNote error={error} />
        </div>
      ) : !rows ? (
        <div className="px-6 pb-4">
          <Loading what="the status of staging and production" />
        </div>
      ) : (
        rows.map((r, i) => <BoardEnv key={r.env} row={r} divided={i > 0} />)
      )}
      <dl className="grid grid-cols-3 border-t border-line max-[700px]:grid-cols-1">
        <BoardFact label="Deploys today" href="/audit">
          {shown(day, (d) => (
            <>
              {d.started}
              {d.finished > 0 ? (
                <small className="text-[13px] font-normal text-fg-2">
                  {" "}
                  · {d.failed} of {d.finished} failed
                </small>
              ) : null}
            </>
          ))}
        </BoardFact>
        <BoardFact label="Previews live" href="/environments">
          {shown(previews, (p) => (
            <>
              {p.live}
              {p.ending > 0 ? <small className="text-[13px] font-medium text-warn-fg"> · {p.ending} {p.ending === 1 ? "ends" : "end"} soon</small> : null}
            </>
          ))}
        </BoardFact>
        <BoardFact label="Clusters" href="/clusters">
          {shown(clusters, (cl) =>
            cl.length === 0 ? (
              "None"
            ) : needLook > 0 ? (
              <span className="font-medium text-warn-fg">
                {needLook} of {cl.length} {needLook === 1 ? "needs" : "need"} a look
              </span>
            ) : (
              `${cl.length} healthy`
            ),
          )}
        </BoardFact>
      </dl>
    </section>
  );
}

const envName = { production: "Production", staging: "Staging" };
const swatch = { production: "bg-env-production", staging: "bg-env-staging" };

function BoardEnv({ row, divided }: { row: BoardRow; divided: boolean }) {
  const problems = [row.unhealthy ? `${row.unhealthy} unhealthy` : "", row.outOfSync ? `${row.outOfSync} out of sync` : ""].filter(Boolean).join(" · ");
  const tone = row.unhealthy ? "text-bad-fg" : row.outOfSync ? "text-warn-fg" : "text-fg-2";
  return (
    <div className={`grid grid-cols-[170px_minmax(0,1fr)] items-start gap-6 px-6 py-4 ${divided ? "border-t border-line" : ""} max-[700px]:grid-cols-1 max-[700px]:gap-2.5 max-[700px]:px-4`}>
      <div>
        <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold [font-stretch:108%]">
          <span aria-hidden="true" className={`size-[9px] flex-none rounded-[2px] ${swatch[row.env]}`} />
          {envName[row.env]}
        </h3>
        {row.tiles.length > 0 ? (
          <>
            <p className={`mt-1 text-[13.5px] font-medium ${tone}`}>{problems || `All ${row.tiles.length} healthy`}</p>
            <p className="mt-px text-[12.5px] text-fg-3">
              {row.tiles.length} running{row.notDeployed ? ` · ${row.notDeployed} not deployed` : ""}
            </p>
          </>
        ) : null}
      </div>
      {row.tiles.length === 0 ? (
        <p className="self-center text-[13.5px] text-fg-2">Nothing is deployed to {row.env} yet.</p>
      ) : (
        <ul aria-label={envName[row.env]} className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-1.5 max-[700px]:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
          {row.tiles.map((t) => (
            <li key={t.service} className="min-w-0">
              <BoardTile tile={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const tileLook: Record<Tile["severity"], { box: string; dot: string; word: string }> = {
  bad: { box: "bg-bad-bg border-bad-dot/35", dot: "bg-bad-dot rounded-[2px]", word: "font-medium text-bad-fg" },
  warn: { box: "bg-warn-bg border-warn-dot/45", dot: "bg-warn-dot rounded-full", word: "font-medium text-warn-fg" },
  ok: { box: "bg-surface-2 border-transparent hover:border-line-strong", dot: "bg-ok-dot rounded-full", word: "text-fg-3" },
};

// A tile is a service in one environment. Only a problem has colour; a
// healthy tile names what runs, and says it is healthy to a screen reader.
function BoardTile({ tile }: { tile: Tile }) {
  const look = tileLook[tile.severity];
  return (
    <Link href={tile.href} className={`flex min-w-0 flex-col gap-0.5 rounded-md border px-2.5 py-2 no-underline ${look.box}`}>
      <span className="flex min-w-0 items-center gap-[7px] font-mono text-[12.5px] font-medium">
        <span aria-hidden="true" className={`size-[7px] flex-none ${look.dot}`} />
        <span className="truncate">{tile.service}</span>
      </span>
      <span className={`truncate pl-3.5 text-[12px] ${look.word}`}>
        {tile.severity === "ok" ? <span className="sr-only">Healthy, running </span> : null}
        {tile.severity === "ok" ? <span className="font-mono">{tile.word}</span> : tile.word}
        {tile.when ? ` · ${tile.when}` : ""}
      </span>
    </Link>
  );
}

function BoardFact({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-0.5 px-6 py-3 not-first:border-l not-first:border-line max-[700px]:px-4 max-[700px]:not-first:border-t max-[700px]:not-first:border-l-0">
      <dt className="text-[12.5px] text-fg-3">
        <Link href={href} className="text-inherit no-underline hover:underline">
          {label}
        </Link>
      </dt>
      <dd className="text-[14px] font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-[11px] first:border-t-0";

function AttentionRow({ item, onExtend }: { item: Attention; onExtend: (e: Environment) => void }) {
  // Only a preview is extended from here; its service decides who may.
  const canExtend = usePermissions(item.extend ? serviceId(item.extend.service) : undefined).can("environment.extend");
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
      {item.extend && canExtend ? (
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
