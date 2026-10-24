"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useApi } from "@/components/providers";
import { ExternalButton } from "@/components/ui/button";
import { NameLink } from "@/components/ui/button";
import { Crumbs, Empty, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { EnvTag, StatusBadge, Tag } from "@/components/ui/status";
import type { Node } from "@/gen/forge/v1/cluster_pb";
import { serviceId } from "@/lib/api";
import { clusterStatus, cores, gib, usage, volumeMeter } from "@/lib/cluster";
import { when } from "@/lib/format";
import type { Status } from "@/lib/status";

function nodeStatus(n: Node): Status {
  if (n.condition === "Ready") return { tone: "success", word: "Ready" };
  if (n.condition === "NotReady") return { tone: "danger", word: "Not ready" };
  return { tone: "warning", word: n.condition.replace(/([a-z])([A-Z])/g, "$1 $2") };
}

// One cluster: its totals and every node.
export default function ClusterPage() {
  const { name: id } = useParams<{ name: string }>();
  const api = useApi();
  const cluster = useQuery({
    queryKey: ["cluster", id],
    queryFn: () => api.clusters.getCluster({ name: `clusters/${id}` }).then((r) => r.cluster),
    refetchInterval: 60_000,
  });

  if (cluster.isPending) return <Loading what="the cluster" />;
  if (cluster.error) return <ErrorNote error={cluster.error} />;
  const c = cluster.data;
  if (!c) return <ErrorNote error={new Error("This cluster does not exist.")} />;
  const u = usage(c.totals, c.metricsAvailable, c.storageAvailable);
  const status = clusterStatus(c);

  return (
    <>
      <PageHeader
        title={id}
        mono
        crumbs={
          <Crumbs>
            <Link href="/clusters">Clusters</Link>
            <span>/</span>
            <span>{id}</span>
          </Crumbs>
        }
        lead={`Kubernetes ${c.kubernetesVersion} · ${c.nodes.length} ${c.nodes.length === 1 ? "node" : "nodes"}${c.createTime ? ` · since ${when(c.createTime)}` : ""}`}
        cli={`forge cluster get ${id}`}
      >
        {c.grafanaUrl ? <ExternalButton href={c.grafanaUrl}>Open in Grafana</ExternalButton> : null}
      </PageHeader>

      <div className="grid grid-cols-2 gap-2.5 rail:grid-cols-5">
        <Stat label="CPU">{u.cpu.pct === null ? <span className="text-[13.5px]">{u.cpu.total}</span> : <Meter label="CPU" meter={u.cpu} big />}</Stat>
        <Stat label="Memory">{u.memory.pct === null ? <span className="text-[13.5px]">{u.memory.total}</span> : <Meter label="Memory" meter={u.memory} big />}</Stat>
        <Stat label="Disk">{u.disk.pct === null ? <span className="text-[13.5px] text-fg-3">No figures</span> : <Meter label="Disk" meter={u.disk} big />}</Stat>
        <Stat label="Pods">
          <span className="font-display text-[26px] font-semibold tabular-nums">{c.totals?.pods ?? 0}</span>
          <span className="text-[12.5px] text-fg-3">of {c.totals?.podsMax ?? 0} that fit</span>
        </Stat>
        <Stat label="Status">
          <span>
            <StatusBadge status={status} />
          </span>
        </Stat>
      </div>

      <Section title="Nodes" note={c.nodes.length}>
        <TableFrame label="Nodes">
          <thead>
            <tr>
              <th className={th}>Node</th>
              <th className={th}>Condition</th>
              <th className={`${th} w-[190px]`}>CPU</th>
              <th className={`${th} w-[190px]`}>Memory</th>
              <th className={`${th} w-[190px]`}>Disk</th>
              <th className={th}>Pods</th>
            </tr>
          </thead>
          <tbody>
            {c.nodes.map((n) => {
              const nu = usage(n.capacity, c.metricsAvailable, c.storageAvailable);
              return (
                <tr key={n.name} className={tr}>
                  <td className={td}>
                    <span className="font-mono text-[13.5px] font-medium">{n.name}</span>
                    <div className="text-[12.5px] text-fg-3">
                      {n.roles.join(", ")} · {cores(n.capacity?.cpuMillis ?? BigInt(0))} · {gib(n.capacity?.memoryBytes ?? BigInt(0))}
                    </div>
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge status={nodeStatus(n)} />
                      {n.schedulable ? null : <Tag>cordoned</Tag>}
                    </span>
                  </td>
                  <td className={td}>
                    <Meter label={`${n.name} CPU`} meter={nu.cpu} />
                  </td>
                  <td className={td}>
                    <Meter label={`${n.name} memory`} meter={nu.memory} />
                  </td>
                  <td className={td}>
                    <Meter label={`${n.name} disk`} meter={nu.disk} />
                  </td>
                  <td className={`${td} text-fg-2`}>
                    {n.capacity?.pods ?? 0}/{n.capacity?.podsMax ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      </Section>

      {c.storageAvailable ? (
        <Section title="Volumes" note={c.volumes.length}>
          {c.volumes.length === 0 ? (
            <Empty>No persistent volumes on this cluster.</Empty>
          ) : (
            <TableFrame label="Volumes">
              <thead>
                <tr>
                  <th className={th}>Volume</th>
                  <th className={th}>Service</th>
                  <th className={`${th} w-[220px]`}>Used</th>
                </tr>
              </thead>
              <tbody>
                {c.volumes.map((v) => {
                  const svc = serviceId(v.service);
                  return (
                    <tr key={`${v.namespace}/${v.claim}`} className={tr}>
                      <td className={td}>
                        <span className="font-mono text-[13.5px] font-medium">{v.claim}</span>
                        <div className="font-mono text-[12px] text-fg-3">{v.namespace}</div>
                      </td>
                      <td className={td}>
                        {svc ? (
                          <span className="inline-flex items-center gap-2">
                            <NameLink href={`/services/${encodeURIComponent(svc)}`}>{svc}</NameLink>
                            {v.environment ? (
                              <EnvTag kind={v.environment === "staging" || v.environment === "production" ? v.environment : "preview"} name={v.environment} />
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-fg-3">–</span>
                        )}
                      </td>
                      <td className={td}>
                        <Meter label={`${v.namespace}/${v.claim}`} meter={volumeMeter(v)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
          )}
        </Section>
      ) : null}

      <p className="text-[12.5px] text-fg-3">
        {c.metricsAvailable
          ? "CPU and memory in use come from metrics-server, disk and volumes from Prometheus. The totals count only the nodes that take new pods: not cordoned, and ready. Amber from 80% used, red from 90%."
          : "No usage figures: metrics-server did not answer the Forge API. The nodes and their conditions are current."}
        {c.storageAvailable ? null : " No disk or volume figures: the Forge API has no Prometheus, or it did not answer."}
      </p>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Panel className="flex flex-col gap-2.5 px-5 py-4">
      <span className="type-label uppercase tracking-[0.05em] text-fg-3">{label}</span>
      {children}
    </Panel>
  );
}
