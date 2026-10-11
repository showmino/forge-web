"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCanWrite } from "@/components/app-shell";
import { actorText } from "@/components/audit-table";
import { OperationLog } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import {
  DeployDialog,
  DestroyDialog,
  ExtendDialog,
  PreviewDialog,
  PromoteDialog,
  RollbackDialog,
} from "@/components/service-actions";
import { Addr, Button, Icon, NameLink, TextLink } from "@/components/ui/button";
import { Crumbs, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, Life, StatusBadge } from "@/components/ui/status";
import { Deployment_Health } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId, serviceId } from "@/lib/api";
import { exact, shortCommit, timeUntil, when } from "@/lib/format";
import { auditStatus, deploymentStatus, environmentStatus } from "@/lib/status";

type Open =
  | { kind: "deploy" | "promote" | "preview" }
  | { kind: "rollback"; env: "staging" | "production" }
  | { kind: "extend" | "destroy"; environment: Environment };

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0";

// One service: what runs in staging and production, its previews, its recent
// history and who owns it. A writer also deploys, promotes, rolls back and
// manages previews from here.
export default function ServicePage() {
  const { name: id } = useParams<{ name: string }>();
  const name = `services/${id}`;
  const api = useApi();
  const queries = useQueryClient();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState<Open | null>(null);
  const [started, setStarted] = useState<string[]>([]);

  const service = useQuery({
    queryKey: ["service", id],
    queryFn: () => api.catalog.getService({ name }).then((r) => r.service),
  });
  const deployments = useQuery({
    queryKey: ["deployments", id],
    queryFn: () => api.deploys.listDeployments({ service: name }).then((r) => r.deployments),
  });
  const previews = useQuery({
    queryKey: ["environments", id],
    queryFn: () =>
      api.environments.listEnvironments({ service: name }).then((r) => r.environments.filter((e) => e.service === name)),
  });
  const events = useQuery({
    queryKey: ["audit", { service: id, recent: true }],
    queryFn: () => api.audit.listAuditEvents({ service: name, pageSize: 8 }).then((r) => r.events),
  });
  // Work on this service that was already running when the page opened.
  const running = useQuery({
    queryKey: ["operations", "running", id],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
  });
  const previewNames = new Set((previews.data ?? []).map((e) => e.name));
  const inProgress = [
    ...started,
    ...(running.data ?? [])
      .filter((op) => op.target.startsWith(`deployments/${id}/`) || previewNames.has(op.target))
      .map((op) => op.name)
      .filter((n) => !started.includes(n)),
  ];

  // What the page shows may have changed: an action was taken or an operation ended.
  function refresh() {
    for (const key of ["deployments", "environments", "audit", "history"]) void queries.invalidateQueries({ queryKey: [key] });
  }
  function onStarted(operation: string | undefined) {
    setOpen(null);
    if (operation) setStarted((s) => (s.includes(operation) ? s : [operation, ...s]));
    refresh();
  }
  const close = () => setOpen(null);

  if (service.isPending) return <Loading what="the service" />;
  if (service.error) return <ErrorNote error={service.error} />;
  const s = service.data;
  if (!s) return <ErrorNote error={new Error("This service does not exist, or it was removed.")} />;

  const deployment = (env: string) => deployments.data?.find((x) => x.env === env);
  const deployed = (env: string) => {
    const d = deployment(env);
    return !!d && d.health !== Deployment_Health.MISSING && !!d.commit;
  };
  const staging = deployment("staging");
  // Staging is ahead when it runs a commit production does not: that commit can be promoted.
  const ahead = deployed("staging") && staging?.commit !== deployment("production")?.commit;

  return (
    <>
      <PageHeader
        mono
        title={id}
        crumbs={
          <Crumbs>
            <Link href="/">Services</Link>
            <span>/</span>
            <span>{s.ownerTeam || "No team"}</span>
          </Crumbs>
        }
        lead={
          <>
            {s.displayName && s.displayName !== id ? `${s.displayName} ` : null}
            <Life lifecycle={s.lifecycle} />
          </>
        }
        cli={`forge service get ${id}`}
      >
        {canWrite ? (
          <>
            <Button onClick={() => setOpen({ kind: "preview" })}>
              <Icon name="plus" />
              Preview env
            </Button>
            {ahead && staging ? (
              <>
                <Button onClick={() => setOpen({ kind: "deploy" })} aria-label="Deploy to staging">
                  Deploy
                </Button>
                <Button
                  kind="primary"
                  onClick={() => setOpen({ kind: "promote" })}
                  aria-label={`Promote ${shortCommit(staging.commit)} to production`}
                >
                  <Icon name="ship" />
                  Promote {shortCommit(staging.commit)}
                </Button>
              </>
            ) : (
              <Button kind="primary" onClick={() => setOpen({ kind: "deploy" })} aria-label="Deploy to staging">
                <Icon name="ship" />
                Deploy
              </Button>
            )}
          </>
        ) : null}
      </PageHeader>

      {inProgress.length > 0 ? (
        <Section title="In progress">
          {inProgress.map((op) => (
            <OperationLog key={op} name={op} onDone={refresh} />
          ))}
        </Section>
      ) : null}

      <Section
        title="Staging and production"
        note={
          deployments.data && deployed("staging")
            ? ahead
              ? "Staging is ahead of production"
              : "Both run the same commit"
            : undefined
        }
      >
        {deployments.isPending ? (
          <Loading what="deployments" />
        ) : deployments.error ? (
          <ErrorNote error={deployments.error} />
        ) : (
          <TableFrame label="Deployments">
            <thead>
              <tr>
                <th className={th}>Environment</th>
                <th className={th}>Status</th>
                <th className={th}>Commit</th>
                <th className={th}>Deployed</th>
                <th className={th}>By</th>
                <th className={th}>Address</th>
                {canWrite ? <th className={th}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {(["staging", "production"] as const).map((env) => {
                const d = deployment(env);
                return (
                  <tr key={env} className={tr}>
                    <td className={td}>
                      <EnvTag kind={env} />
                    </td>
                    <td className={td}>
                      <StatusBadge status={deploymentStatus(d)} title={d?.message || undefined} />
                    </td>
                    <td className={td}>
                      <span className={`font-mono text-[13px] ${env === "staging" && ahead ? "font-semibold text-ember-ink" : ""}`}>
                        {d?.commit ? shortCommit(d.commit) : "–"}
                      </span>
                    </td>
                    <td className={`${td} text-fg-3`} title={exact(d?.deployTime)}>
                      {when(d?.deployTime)}
                    </td>
                    <td className={`${td} text-[13px]`}>{d?.deployedBy || "–"}</td>
                    <td className={td}>{d?.url ? <Addr href={d.url} /> : "–"}</td>
                    {canWrite ? (
                      <td className={td}>
                        {deployed(env) ? (
                          <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "rollback", env })} aria-label={`Roll back ${env}`}>
                            Roll back
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 min-[1081px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Previews" note={previews.data ? String(previews.data.length) : undefined}>
            {previews.isPending ? (
              <Loading what="previews" />
            ) : previews.error ? (
              <ErrorNote error={previews.error} />
            ) : previews.data.length === 0 ? (
              <Panel className="p-6 text-center text-[13.5px] text-fg-2">
                No previews. Create one for any branch with{" "}
                <span className="font-mono text-[12.5px]">forge env create &lt;name&gt; --service {id}</span>.
              </Panel>
            ) : (
              <Panel>
                <ul aria-label="Previews">
                  {previews.data.map((e) => {
                    const preview = environmentId(e.name);
                    return (
                      // The row wraps on a narrow screen: the actions drop below the details.
                      <li key={e.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-[11px] first:border-t-0">
                        <EnvTag kind="preview" name={preview} />
                        <div className="min-w-0 flex-[1_1_200px]">
                          <div className="min-w-0 font-medium">{e.url ? <Addr href={e.url} /> : <span className="text-fg-3">No address yet</span>}</div>
                          <div className="mt-px text-[12.5px] text-fg-3">
                            <span className="font-mono">{e.ref || "main"}</span>
                            {e.commit ? ` at ${shortCommit(e.commit)}` : ""}
                            {e.creator ? ` · ${e.creator}` : ""}
                            {e.expireTime ? ` · expires ${timeUntil(timestampDate(e.expireTime))}` : ""}
                          </div>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                          <StatusBadge status={environmentStatus(e)} title={e.stateMessage || undefined} />
                          {canWrite ? (
                            <>
                              <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "extend", environment: e })} aria-label={`Extend ${preview}`}>
                                Extend
                              </Button>
                              <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "destroy", environment: e })} aria-label={`Destroy ${preview}`}>
                                Destroy
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </Section>

          <Section
            title="Recent activity"
            action={
              <TextLink href={`/audit?service=${encodeURIComponent(id)}`} className="text-[13px] !text-fg-2">
                All activity of {id}
              </TextLink>
            }
          >
            {events.isPending ? (
              <Loading what="recent activity" />
            ) : events.error ? (
              <ErrorNote error={events.error} />
            ) : events.data.length === 0 ? (
              <Panel className="p-6 text-center text-[13.5px] text-fg-2">Nothing has happened to this service yet.</Panel>
            ) : (
              <Panel>
                <ul aria-label="Recent activity">
                  {events.data.map((e) => (
                    <li key={e.name} className={row}>
                      <span aria-hidden="true" className="w-[3px] self-stretch rounded-sm bg-line-strong" />
                      <div className="min-w-0">
                        <div className="min-w-0 font-medium">
                          <span className="font-mono text-[13px]">{e.action}</span>{" "}
                          <span className="font-normal text-fg-3">{e.target}</span>
                        </div>
                        <div className="mt-px text-[12.5px] text-fg-3" title={exact(e.time)}>
                          {actorText(e)} · {when(e.time)}
                        </div>
                      </div>
                      <StatusBadge status={auditStatus(e.result?.code)} title={e.result?.message || e.result?.code} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <div className="px-4 pb-3 pt-4">
              <h2 className="type-heading">About</h2>
            </div>
            <div className="px-4 pb-4">
              <Facts
                items={[
                  ["Team", s.ownerTeam || "–"],
                  ["Owners", s.owners.length ? s.owners.join(", ") : "–"],
                  ["Lifecycle", <Life key="l" lifecycle={s.lifecycle} />],
                  ["Repository", s.repoUrl ? <Addr key="r" href={s.repoUrl} /> : "–"],
                  [
                    "Depends on",
                    s.dependencies.length
                      ? s.dependencies.map((d, i) => (
                          <span key={d}>
                            {i > 0 ? ", " : null}
                            <NameLink href={`/services/${serviceId(d)}`}>{serviceId(d)}</NameLink>
                          </span>
                        ))
                      : "–",
                  ],
                  ["Registered", when(s.createTime)],
                ]}
              />
            </div>
          </Panel>
        </div>
      </div>

      {open?.kind === "deploy" ? <DeployDialog id={id} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "promote" ? (
        <PromoteDialog id={id} staging={deployment("staging")} onClose={close} onStarted={onStarted} />
      ) : null}
      {open?.kind === "rollback" ? <RollbackDialog id={id} env={open.env} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "preview" ? <PreviewDialog id={id} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "extend" ? <ExtendDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "destroy" ? <DestroyDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
    </>
  );
}
