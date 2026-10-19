"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePermissions } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { ButtonLink, Icon, NameLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Life, StatusBadge } from "@/components/ui/status";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
import { listAllServices, serviceId } from "@/lib/api";
import { when } from "@/lib/format";
import { deploymentStatus } from "@/lib/status";

const chip =
  "cursor-pointer rounded-full border px-[11px] py-1 text-[13px] aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-bg";
const chipOff = "border-line bg-surface text-fg-2 hover:border-fg-3 hover:text-fg";

// The catalog: every service, who owns it, and how staging and production are doing.
export default function Catalog() {
  const api = useApi();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
  });
  const [filter, setFilter] = useState("");
  const [team, setTeam] = useState("");
  const canCreate = usePermissions().can("service.create");

  const byEnv = useMemo(() => {
    const m = new Map<string, Deployment>();
    for (const d of deployments.data ?? []) m.set(`${d.service}/${d.env}`, d);
    return m;
  }, [deployments.data]);

  const all = services.data ?? [];
  const teams = [...new Set(all.map((s) => s.ownerTeam).filter(Boolean))].sort();
  const needle = filter.trim().toLowerCase();
  const shown = all.filter(
    (s) =>
      (!team || s.ownerTeam === team) &&
      (!needle || `${serviceId(s.name)} ${s.displayName} ${s.ownerTeam} ${s.owners.join(" ")}`.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Services"
        lead="Every service in the catalog, and how its environments are doing."
        cli={team ? `forge service list --team ${team}` : "forge service list"}
      >
        {canCreate ? (
          <ButtonLink kind="primary" href="/create">
            <Icon name="plus" />
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>

      {services.isPending ? (
        <Loading what="services" />
      ) : services.error ? (
        <ErrorNote error={services.error} />
      ) : all.length === 0 ? (
        <Empty>No services yet. {canCreate ? "Create the first one from a template." : "Members of a team create one from a template."}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="service-filter" className="sr-only">
              Filter services
            </label>
            <input
              id="service-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Name or team"
              className="w-full max-w-[260px] rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] text-fg placeholder:text-fg-3"
            />
            <button type="button" className={`${chip} ${team ? chipOff : ""}`} aria-pressed={!team} onClick={() => setTeam("")}>
              All teams <span className="font-mono text-[11.5px] opacity-80">{all.length}</span>
            </button>
            {teams.map((t) => (
              <button
                key={t}
                type="button"
                className={`${chip} ${team === t ? "" : chipOff}`}
                aria-pressed={team === t}
                onClick={() => setTeam(team === t ? "" : t)}
              >
                {t}{" "}
                <span className="font-mono text-[11.5px] opacity-80">{all.filter((s) => s.ownerTeam === t).length}</span>
              </button>
            ))}
          </div>

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
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${td} text-fg-3`}>
                    No services match. Clear the filter or pick another team.
                  </td>
                </tr>
              ) : null}
              {shown.map((s) => {
                const id = serviceId(s.name);
                return (
                  <tr key={s.name} className={tr}>
                    <td className={td}>
                      <div className="flex min-w-0 flex-col gap-px">
                        <NameLink href={`/services/${id}`}>{id}</NameLink>
                        {s.displayName && s.displayName !== id ? (
                          <span className="text-[12.5px] text-fg-3">{s.displayName}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={td}>{s.ownerTeam || "–"}</td>
                    <td className={td}>
                      <Life lifecycle={s.lifecycle} />
                    </td>
                    {(["staging", "production"] as const).map((env) => (
                      <td key={env} className={td}>
                        {deployments.isPending ? (
                          <span className="text-fg-3">…</span>
                        ) : deployments.error ? (
                          <span className="text-fg-3">Not known</span>
                        ) : (
                          <StatusBadge status={deploymentStatus(byEnv.get(`${s.name}/${env}`))} />
                        )}
                      </td>
                    ))}
                    <td className={`${td} text-fg-3`}>{when(s.updateTime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
          <p className="text-[12.5px] text-fg-3">
            {shown.length} {shown.length === 1 ? "service" : "services"} shown.
          </p>
        </>
      )}
    </>
  );
}
