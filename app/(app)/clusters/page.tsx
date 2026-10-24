"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/providers";
import { ExternalButton, NameLink } from "@/components/ui/button";
import { ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { StatusBadge } from "@/components/ui/status";
import { clusterId } from "@/lib/api";
import { clusterStatus, usage } from "@/lib/cluster";

// The clusters Forge runs on, and how much room each has left. Admins only.
export default function Clusters() {
  const api = useApi();
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api.clusters.listClusters({}).then((r) => r.clusters),
    refetchInterval: 60_000,
  });
  const grafana = clusters.data?.find((c) => c.grafanaUrl)?.grafanaUrl;

  return (
    <>
      <PageHeader
        title="Clusters"
        lead="How much room each cluster has left: its nodes, their CPU, memory and disk in use now, and its volumes. Figures come from metrics-server and Prometheus and are at most a minute old."
        cli="forge cluster list"
      >
        {grafana ? <ExternalButton href={grafana}>Open Grafana</ExternalButton> : null}
      </PageHeader>
      {clusters.isPending ? (
        <Loading what="clusters" />
      ) : clusters.error ? (
        <ErrorNote error={clusters.error} />
      ) : (
        <TableFrame label="Clusters">
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Status</th>
              <th className={`${th} w-[170px]`}>CPU</th>
              <th className={`${th} w-[170px]`}>Memory</th>
              <th className={`${th} w-[170px]`}>Storage</th>
              <th className={th}>Nodes</th>
              <th className={th}>Kubernetes</th>
            </tr>
          </thead>
          <tbody>
            {clusters.data.map((c) => {
              const id = clusterId(c.name);
              const u = usage(c.totals, c.metricsAvailable, c.storageAvailable);
              return (
                <tr key={c.name} className={tr}>
                  <td className={td}>
                    <NameLink href={`/clusters/${encodeURIComponent(id)}`}>{id}</NameLink>
                  </td>
                  <td className={td}>
                    <StatusBadge status={clusterStatus(c)} />
                  </td>
                  <td className={td}>
                    <Meter label="CPU" meter={u.cpu} />
                  </td>
                  <td className={td}>
                    <Meter label="Memory" meter={u.memory} />
                  </td>
                  <td className={td}>
                    <Meter label="Storage" meter={u.disk} />
                  </td>
                  <td className={td}>{c.nodes.length}</td>
                  <td className={`${td} font-mono text-[12.5px] text-fg-2`}>{c.kubernetesVersion}</td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      )}
    </>
  );
}
