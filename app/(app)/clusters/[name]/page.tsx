"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useApi } from "@/components/providers";
import { ExternalButton } from "@/components/ui/button";
import { Crumbs, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { StatusBadge, Tag } from "@/components/ui/status";
import type { Node } from "@/gen/forge/v1/cluster_pb";
import { clusterStatus, cores, gib, usage } from "@/lib/cluster";
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
  const u = usage(c.totals, c.metricsAvailable);
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

      <div className="grid grid-cols-2 gap-2.5 rail:grid-cols-4">
        <Stat label="CPU">{u.cpu.pct === null ? <span className="text-[13.5px]">{u.cpu.total}</span> : <Meter label="CPU" meter={u.cpu} big />}</Stat>
        <Stat label="Memory">{u.memory.pct === null ? <span className="text-[13.5px]">{u.memory.total}</span> : <Meter label="Memory" meter={u.memory} big />}</Stat>
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
              <th className={th}>Pods</th>
            </tr>
          </thead>
          <tbody>
            {c.nodes.map((n) => {
              const nu = usage(n.capacity, c.metricsAvailable);
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
                  <td className={`${td} text-fg-2`}>
                    {n.capacity?.pods ?? 0}/{n.capacity?.podsMax ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      </Section>

      <p className="text-[12.5px] text-fg-3">
        {c.metricsAvailable
          ? "CPU and memory in use come from metrics-server. The totals count only the nodes that take new pods: not cordoned, and ready. Amber from 80% used, red from 90%."
          : "No usage figures: metrics-server did not answer the Forge API. The nodes and their conditions are current."}
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
