"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCanWrite } from "@/components/app-shell";
import { OperationLog } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { DestroyDialog, ExtendDialog, PreviewDialog } from "@/components/service-actions";
import { Addr, Button, Icon, NameLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, StatusBadge } from "@/components/ui/status";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId, lastDay, listAllServices, serviceId } from "@/lib/api";
import { envSummary, previewLife } from "@/lib/environments";
import { dayStats } from "@/lib/overview";
import { environmentStatus } from "@/lib/status";

type Open = { kind: "preview" } | { kind: "extend" | "destroy"; environment: Environment };

const ENVS = [
  ["staging", "Every push to main lands here first, as a release candidate."],
  ["production", "Promoted from staging. Serves real traffic."],
] as const;

// Every service runs in staging and production; previews are short-lived
// copies of one branch.
export default function Environments() {
  const api = useApi();
  const queries = useQueryClient();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState<Open | null>(null);
  const [started, setStarted] = useState<string[]>([]);

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
  const audit = useQuery({ queryKey: ["audit", "last-day"], queryFn: () => lastDay(api), refetchInterval: 30_000 });

  function refresh() {
    for (const key of ["environments", "operations", "audit"]) void queries.invalidateQueries({ queryKey: [key] });
  }
  function onStarted(operation: string | undefined) {
    setOpen(null);
    if (operation) setStarted((s) => (s.includes(operation) ? s : [operation, ...s]));
    refresh();
  }
  const close = () => setOpen(null);
  const previews = environments.data ?? [];

  return (
    <>
      <PageHeader
        title="Environments"
        lead="Every service runs in staging and production. Previews are short-lived copies of one branch, each at its own address."
        cli="forge env list"
      >
        {canWrite ? (
          <Button kind="primary" onClick={() => setOpen({ kind: "preview" })}>
            <Icon name="plus" />
            Preview env
          </Button>
        ) : null}
      </PageHeader>

      {started.length > 0 ? (
        <Section title="In progress">
          {started.map((op) => (
            <OperationLog key={op} name={op} onDone={refresh} />
          ))}
        </Section>
      ) : null}

      <Section title="Staging and production">
        {deployments.isPending ? (
          <Loading what="deployments" />
        ) : deployments.error ? (
          <ErrorNote error={deployments.error} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {ENVS.map(([env, about]) => {
              const s = envSummary(deployments.data, env);
              const today = audit.data ? dayStats(audit.data.filter((e) => e.target.endsWith(`/${env}`))).started : null;
              return (
                <Panel key={env} className="flex flex-col gap-3 px-6 py-4">
                  <section aria-label={env} className="contents">
                    <div className="flex items-center gap-2">
                      <EnvTag kind={env} />
                      <span className="ml-auto">
                        <StatusBadge status={s.status} />
                      </span>
                    </div>
                    <p className="text-[13.5px] text-fg-2">{about}</p>
                    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-fg-2">
                      {[
                        ["services", s.deployed],
                        ["healthy", s.healthy],
                        ["deploys today", today ?? "…"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex flex-col-reverse">
                          <dt>{label}</dt>
                          <dd className="font-display text-[20px] font-bold text-fg tabular-nums [font-stretch:110%]">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.needsLook.length > 0 ? (
                      <p className="text-[12.5px] text-fg-2">
                        Needs a look:{" "}
                        {s.needsLook.map((id, i) => (
                          <span key={id}>
                            {i > 0 ? ", " : null}
                            <NameLink href={`/services/${id}`} className="!text-[12.5px]">
                              {id}
                            </NameLink>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </section>
                </Panel>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Previews" note={environments.data ? previews.length : undefined}>
        {environments.isPending ? (
          <Loading what="previews" />
        ) : environments.error ? (
          <ErrorNote error={environments.error} />
        ) : previews.length === 0 ? (
          <Empty>
            No previews. Create one for any branch with{" "}
            <span className="font-mono text-[12.5px]">forge env create &lt;name&gt; --service &lt;service&gt;</span>.
          </Empty>
        ) : (
          <TableFrame label="Previews">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Service</th>
                <th className={th}>Status</th>
                <th className={th}>Time left</th>
                <th className={th}>Created by</th>
                {canWrite ? (
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {previews.map((e) => {
                const id = environmentId(e.name);
                const svc = serviceId(e.service);
                const life = previewLife(e);
                return (
                  <tr key={e.name} className={tr}>
                    <td className={td}>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <EnvTag kind="preview" name={id} />
                        {e.url ? <Addr href={e.url} className="!text-[12px]" /> : null}
                      </div>
                    </td>
                    <td className={td}>
                      <NameLink href={`/services/${svc}`}>{svc}</NameLink>
                      <div className="text-[12.5px] text-fg-3">
                        <span className="font-mono">{e.ref || "main"}</span>
                      </div>
                    </td>
                    <td className={td}>
                      <StatusBadge status={environmentStatus(e)} title={e.stateMessage || undefined} />
                    </td>
                    <td className={td}>
                      {life ? (
                        <div className="flex min-w-[150px] flex-col gap-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                            <i className={`block h-full rounded-full ${life.soon ? "bg-warn-dot" : "bg-fg-3"}`} style={{ width: `${Math.round(life.share * 100)}%` }} />
                          </div>
                          <span className="text-[12px] text-fg-2">{life.words}</span>
                        </div>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className={`${td} font-mono text-[12.5px]`}>{e.creator || "–"}</td>
                    {canWrite ? (
                      <td className={`${td} text-right`}>
                        <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "extend", environment: e })} aria-label={`Extend ${id}`}>
                          Extend
                        </Button>
                        <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "destroy", environment: e })} aria-label={`Destroy ${id}`}>
                          Destroy
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </Section>

      {open?.kind === "preview" ? (
        <PreviewDialog services={(services.data ?? []).map((s) => serviceId(s.name))} onClose={close} onStarted={onStarted} />
      ) : null}
      {open?.kind === "extend" ? <ExtendDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "destroy" ? <DestroyDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
    </>
  );
}
