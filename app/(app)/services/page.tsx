"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePermissions } from "@/components/app-shell";
import { CatalogTabs } from "@/components/catalog-tabs";
import { useApi } from "@/components/providers";
import { ButtonLink, Icon } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { btd, bth, Card, Chip, Choose, ct, Find, FilterBar, ServiceName, wide } from "@/components/ui/portal";
import { Life, StatusBadge } from "@/components/ui/status";
import { listAllServices } from "@/lib/api";
import { catalogRows, filterRows, type StatusFilter, teamsOf } from "@/lib/catalog";

// The Catalog: every service in one table, the environment where each hurts
// most first, with search and filters in one row.
export default function Catalog() {
  const api = useApi();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
  });
  const canCreate = usePermissions().can("service.create");
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const all = useMemo(() => services.data ?? [], [services.data]);
  const rows = useMemo(() => catalogRows(all, deployments.data ?? []), [all, deployments.data]);
  const shown = filterRows(rows, { query, team, status });
  const filtered = query !== "" || team !== "all" || status !== "all";
  const clear = () => {
    setQuery("");
    setTeam("all");
    setStatus("all");
  };

  return (
    <>
      <PageHeader title="Catalog" lead="Find, create and manage services, templates and the resources they use." cli={team !== "all" ? `forge service list --team ${team}` : "forge service list"}>
        {canCreate ? (
          <ButtonLink kind="primary" href="/create">
            <Icon name="plus" />
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-4">
        <CatalogTabs current="services" />

        {services.isPending ? (
          <Loading what="services" />
        ) : services.error ? (
          <ErrorNote error={services.error} />
        ) : all.length === 0 ? (
          <Empty>No services yet. {canCreate ? "Create the first one with Create service, above." : "Members of a team create one from a template."}</Empty>
        ) : (
          <>
            <FilterBar label="Filter services">
              <Find label="Search services…" value={query} onChange={setQuery} />
              <Choose label="Owner" value={team} onChange={setTeam} options={[["all", "All"], ...teamsOf(all).map((t): [string, string] => [t, t])]} />
              <Choose
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as StatusFilter)}
                options={[
                  ["all", "All"],
                  ["attention", "Needs attention"],
                  ["healthy", "Healthy"],
                  ["ahead", "Ready to promote"],
                ]}
              />
            </FilterBar>

            {deployments.error ? <ErrorNote error={deployments.error} /> : null}

            <Card flush>
              {shown.length === 0 ? (
                <p className="m-0 px-5 py-6 text-[13.5px] text-fg-2">
                  No services match these filters.{" "}
                  <button type="button" className="cursor-pointer text-ember-ink underline" onClick={clear}>
                    Clear filters
                  </button>
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table aria-label="Services" className={ct}>
                      <thead>
                        <tr>
                          <th className={bth}>Service</th>
                          <th className={`${bth} ${wide}`}>Owner</th>
                          <th className={`${bth} ${wide}`}>Lifecycle</th>
                          <th className={`${bth} ${wide}`}>Environment</th>
                          <th className={bth}>Status</th>
                          <th className={`${bth} ${wide}`}>Last deploy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={r.id} className="hover:[&>td]:bg-surface-2">
                            <td className={btd}>
                              <ServiceName id={r.id} sub={r.service.displayName && r.service.displayName !== r.id ? r.service.displayName : undefined} />
                            </td>
                            <td className={`${btd} ${wide}`}>{r.team ? <Chip>{r.team}</Chip> : <span className="text-fg-3">–</span>}</td>
                            <td className={`${btd} ${wide}`}>
                              <Life lifecycle={r.service.lifecycle} />
                            </td>
                            <td className={`${btd} ${wide}`}>{r.env ? <Chip mono>{r.env === "production" ? "prod" : r.env}</Chip> : <span className="text-fg-3">–</span>}</td>
                            <td className={btd}>{deployments.isPending ? <span className="text-fg-3">…</span> : <StatusBadge status={r.status} />}</td>
                            <td className={`${btd} ${wide} text-fg-3`}>{r.when || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-fg-3">
                    {shown.length} {shown.length === 1 ? "service" : "services"}
                    {filtered ? (
                      <>
                        {" "}
                        of {all.length} ·{" "}
                        <button type="button" className="cursor-pointer text-ember-ink underline" onClick={clear}>
                          Clear filters
                        </button>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
