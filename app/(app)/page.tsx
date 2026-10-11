"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApi } from "@/components/providers";
import { useCanWrite } from "@/components/app-shell";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
import { listAllServices, serviceId } from "@/lib/api";
import { when } from "@/lib/format";
import { deploymentStatus, lifecycleWord } from "@/lib/status";

// The catalog: every service, who owns it, and how staging and production are doing.
export default function Catalog() {
  const api = useApi();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
  });
  const [filter, setFilter] = useState("");
  const canWrite = useCanWrite();

  const byEnv = useMemo(() => {
    const m = new Map<string, Deployment>();
    for (const d of deployments.data ?? []) m.set(`${d.service}/${d.env}`, d);
    return m;
  }, [deployments.data]);

  const needle = filter.trim().toLowerCase();
  const shown = (services.data ?? []).filter(
    (s) => !needle || serviceId(s.name).includes(needle) || s.ownerTeam.toLowerCase().includes(needle),
  );

  return (
    <>
      <PageHeader title="Services" lead="Every service in the catalog, and how its environments are doing.">
        <label className="flex items-center gap-2">
          <span className="type-small font-semibold">Filter</span>
          <input
            id="service-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name or team"
            className="h-8 w-56 rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-muted"
          />
        </label>
        {canWrite ? (
          <ButtonLink kind="primary" href="/create">
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>
      {services.isPending ? (
        <Loading what="services" />
      ) : services.error ? (
        <ErrorNote error={services.error} />
      ) : services.data.length === 0 ? (
        <Empty>
          No services yet. {canWrite ? "Create the first one from a template." : "Writers create one from a template."}
        </Empty>
      ) : shown.length === 0 ? (
        <Empty>No service matches “{filter.trim()}”.</Empty>
      ) : (
        <TableFrame label="Services">
          <thead>
            <tr>
              <th className={th}>Service</th>
              <th className={th}>Team</th>
              <th className={th}>Lifecycle</th>
              <th className={th}>Staging</th>
              <th className={th}>Production</th>
              <th className={th}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const id = serviceId(s.name);
              return (
                <tr key={s.name} className={tr}>
                  <td className={td}>
                    <TextLink href={`/services/${id}`} className="type-code">
                      {id}
                    </TextLink>
                  </td>
                  <td className={td}>{s.ownerTeam || "–"}</td>
                  <td className={td}>{lifecycleWord(s.lifecycle)}</td>
                  {(["staging", "production"] as const).map((env) => (
                    <td key={env} className={td}>
                      {deployments.isPending ? (
                        <span className="text-ink-muted">…</span>
                      ) : deployments.error ? (
                        <span className="text-ink-muted">Not known</span>
                      ) : (
                        <StatusBadge status={deploymentStatus(byEnv.get(`${s.name}/${env}`))} />
                      )}
                    </td>
                  ))}
                  <td className={`${td} text-ink-muted`}>{when(s.updateTime)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      )}
    </>
  );
}
