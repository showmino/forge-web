"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCanWrite } from "@/components/app-shell";
import { AuditTable } from "@/components/audit-table";
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
import { Button, TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, StatusBadge } from "@/components/ui/status";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Deployment_Health } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId } from "@/lib/api";
import { shortCommit, timeUntil, when } from "@/lib/format";
import { deploymentStatus, environmentStatus, lifecycleWord } from "@/lib/status";

type Open =
  | { kind: "deploy" | "promote" | "preview" }
  | { kind: "rollback"; env: "staging" | "production" }
  | { kind: "extend" | "destroy"; environment: Environment };

// One service: who owns it, what runs in staging and production, its previews
// and its recent history. A writer also deploys, promotes, rolls back and
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
    queryFn: () => api.audit.listAuditEvents({ service: name, pageSize: 10 }).then((r) => r.events),
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

  return (
    <>
      <PageHeader title={s.displayName || id} lead={<span className="type-code">{id}</span>}>
        {canWrite ? (
          <>
            <Button onClick={() => setOpen({ kind: "deploy" })}>Deploy to staging</Button>
            <Button kind="primary" onClick={() => setOpen({ kind: "promote" })} disabled={!deployed("staging")}>
              Promote to production
            </Button>
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

      <Panel className="p-6">
        <Facts
          items={[
            ["Team", s.ownerTeam || "–"],
            ["Owners", s.owners.length ? s.owners.join(", ") : "–"],
            ["Lifecycle", lifecycleWord(s.lifecycle)],
            [
              "Repository",
              s.repoUrl ? (
                <TextLink href={s.repoUrl} target="_blank" rel="noreferrer">
                  {s.repoUrl.replace(/^https?:\/\//, "")}
                </TextLink>
              ) : (
                "–"
              ),
            ],
            ["Depends on", s.dependencies.length ? s.dependencies.map((d) => d.replace(/^services\//, "")).join(", ") : "–"],
            ["Registered", when(s.createTime)],
          ]}
        />
      </Panel>

      <Section title="Staging and production">
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
                const d = deployments.data.find((x) => x.env === env);
                return (
                  <tr key={env} className={tr}>
                    <td className={td}>
                      <EnvTag kind={env} />
                    </td>
                    <td className={td}>
                      <StatusBadge status={deploymentStatus(d)} title={d?.message || undefined} />
                    </td>
                    <td className={`${td} type-code`}>{d?.commit ? shortCommit(d.commit) : "–"}</td>
                    <td className={`${td} text-ink-muted`}>{when(d?.deployTime)}</td>
                    <td className={td}>{d?.deployedBy || "–"}</td>
                    <td className={td}>
                      {d?.url ? (
                        <TextLink href={d.url} target="_blank" rel="noreferrer">
                          {d.url.replace(/^https?:\/\//, "")}
                        </TextLink>
                      ) : (
                        "–"
                      )}
                    </td>
                    {canWrite ? (
                      <td className={td}>
                        {deployed(env) ? (
                          <Button kind="quiet" onClick={() => setOpen({ kind: "rollback", env })} aria-label={`Roll back ${env}`}>
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

      <Section
        title="Previews"
        action={canWrite ? <Button onClick={() => setOpen({ kind: "preview" })}>Create preview</Button> : null}
      >
        {previews.isPending ? (
          <Loading what="previews" />
        ) : previews.error ? (
          <ErrorNote error={previews.error} />
        ) : previews.data.length === 0 ? (
          <Empty>
            No previews. A preview runs one branch at its own address until its time is up.
            {canWrite ? null : (
              <>
                {" "}
                Writers create one here or with <code className="type-code">forge env create</code>.
              </>
            )}
          </Empty>
        ) : (
          <TableFrame label="Previews">
            <thead>
              <tr>
                <th className={th}>Preview</th>
                <th className={th}>Status</th>
                <th className={th}>Branch</th>
                <th className={th}>Commit</th>
                <th className={th}>Expires</th>
                <th className={th}>Address</th>
                {canWrite ? <th className={th}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {previews.data.map((e) => (
                <tr key={e.name} className={tr}>
                  <td className={td}>
                    <EnvTag kind="preview" name={environmentId(e.name)} />
                  </td>
                  <td className={td}>
                    <StatusBadge status={environmentStatus(e)} title={e.stateMessage || undefined} />
                  </td>
                  <td className={`${td} type-code`}>{e.ref || "–"}</td>
                  <td className={`${td} type-code`}>{e.commit ? shortCommit(e.commit) : "–"}</td>
                  <td className={`${td} text-ink-muted`}>{e.expireTime ? timeUntil(timestampDate(e.expireTime)) : "–"}</td>
                  <td className={td}>
                    {e.url ? (
                      <TextLink href={e.url} target="_blank" rel="noreferrer">
                        {e.url.replace(/^https?:\/\//, "")}
                      </TextLink>
                    ) : (
                      "–"
                    )}
                  </td>
                  {canWrite ? (
                    <td className={td}>
                      <span className="flex gap-1">
                        <Button
                          kind="quiet"
                          onClick={() => setOpen({ kind: "extend", environment: e })}
                          aria-label={`Extend ${environmentId(e.name)}`}
                        >
                          Extend
                        </Button>
                        <Button
                          kind="quiet"
                          onClick={() => setOpen({ kind: "destroy", environment: e })}
                          aria-label={`Destroy ${environmentId(e.name)}`}
                        >
                          Destroy
                        </Button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>

      <Section title="Recent activity">
        {events.isPending ? (
          <Loading what="recent activity" />
        ) : events.error ? (
          <ErrorNote error={events.error} />
        ) : events.data.length === 0 ? (
          <Empty>Nothing has happened to this service yet.</Empty>
        ) : (
          <>
            <AuditTable events={events.data} showService={false} />
            <p>
              <TextLink href={`/audit?service=${encodeURIComponent(id)}`}>All activity of {id}</TextLink>
            </p>
          </>
        )}
      </Section>

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
