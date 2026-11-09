"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CatalogTabs } from "@/components/catalog-tabs";
import { useApi } from "@/components/providers";
import { NameLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { btd, bth, Card, Choose, ct, Find, FilterBar, wide } from "@/components/ui/portal";
import { EnvTag, StatusBadge } from "@/components/ui/status";
import { serviceId } from "@/lib/api";
import { when } from "@/lib/format";
import { healthText, resourceStatus, settingsText } from "@/lib/resources";

const shortName = (name: string) => name.split("/").pop() ?? name;

// Resources: every database and other resource the services declare in
// forge.yaml, in each environment, and how the last apply left it. Plans and
// applies stay on each service's Resources tab, where the team works on them.
export default function Resources() {
  const api = useApi();
  const resources = useQuery({ queryKey: ["resources", "all"], queryFn: () => api.resources.listResources({}).then((r) => r.resources), retry: false });
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState("all");

  const all = resources.data ?? [];
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => (env === "all" || r.env === env) && (!q || `${shortName(r.name)} ${serviceId(r.service)} ${r.type}`.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader title="Resources" lead="Databases the services declare in forge.yaml. Forge plans and applies them with OpenTofu." cli="forge resource list" />
      <div className="flex flex-col gap-4">
        <CatalogTabs current="resources" />
        {resources.isPending ? (
          <Loading what="resources" />
        ) : resources.error ? (
          <ErrorNote error={resources.error} />
        ) : all.length === 0 ? (
          <Empty>
            No resources yet. A service declares a database under <span className="font-mono">resources</span> in its forge.yaml, then plans it with{" "}
            <span className="font-mono">forge resource plan --env staging</span>.
          </Empty>
        ) : (
          <>
            <FilterBar label="Filter resources">
              <Find label="Search resources…" value={query} onChange={setQuery} />
              <Choose
                label="Environment"
                value={env}
                onChange={setEnv}
                options={[
                  ["all", "All"],
                  ["production", "production"],
                  ["staging", "staging"],
                ]}
              />
            </FilterBar>
            <Card flush>
              <div className="overflow-x-auto">
                <table aria-label="Resources" className={ct}>
                  <thead>
                    <tr>
                      <th className={bth}>Resource</th>
                      <th className={bth}>Service</th>
                      <th className={`${bth} ${wide}`}>Environment</th>
                      <th className={`${bth} ${wide}`}>Settings</th>
                      <th className={bth}>State</th>
                      <th className={`${bth} ${wide}`}>Health</th>
                      <th className={`${bth} ${wide}`}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 ? (
                      <tr>
                        <td colSpan={7} className={`${btd} text-fg-3`}>
                          No resources match.
                        </td>
                      </tr>
                    ) : null}
                    {shown.map((r) => (
                      <tr key={r.name} className="hover:[&>td]:bg-surface-2">
                        <td className={btd}>
                          <div className="flex flex-col gap-px">
                            <span className="font-mono font-medium">{shortName(r.name)}</span>
                            <span className="text-[12.5px] text-fg-3">{r.type}</span>
                          </div>
                        </td>
                        <td className={btd}>
                          <NameLink href={`/services/${serviceId(r.service)}`}>{serviceId(r.service)}</NameLink>
                        </td>
                        <td className={`${btd} ${wide}`}>
                          <EnvTag kind={r.env === "production" ? "production" : "staging"} />
                        </td>
                        <td className={`${btd} ${wide}`}>{settingsText(r.settings)}</td>
                        <td className={btd}>
                          <StatusBadge status={resourceStatus(r)} />
                        </td>
                        <td className={`${btd} ${wide} text-fg-2`}>{healthText(r)}</td>
                        <td className={`${btd} ${wide} text-fg-3`}>{when(r.createTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
