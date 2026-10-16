"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePermissions } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { NameLink, TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Stats } from "@/components/ui/pipeline";
import { StatusBadge } from "@/components/ui/status";
import { listAllServices } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ownership } from "@/lib/ownership";

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0";

// Which GitHub team answers for each service, and what has no owner.
export default function Ownership() {
  const api = useApi();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.teams.listTeams({}).then((r) => r.teams) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
  });
  // Without the teams (the App may not read them) every named team counts as owned.
  const o = useMemo(
    () => (services.data ? ownership(services.data, teams.error ? null : (teams.data ?? []), deployments.data ?? []) : null),
    [services.data, teams.data, teams.error, deployments.data],
  );

  return (
    <>
      <PageHeader
        title="Ownership"
        lead="Every service belongs to a GitHub team of the organization, and names the people to ask. A service whose team is not on GitHub has nobody who answers for it."
        cli="forge team list"
      />
      {services.isPending || (teams.isPending && !teams.error) ? (
        <Loading what="owners" />
      ) : services.error ? (
        <ErrorNote error={services.error} />
      ) : o ? (
        <>
          {teams.error ? <ErrorNote error={teams.error} /> : null}
          <Stats
            items={[
              { label: "Services owned by a team", value: o.owned, of: o.total },
              { label: "Services with no contacts", value: o.noContacts.length },
              { label: "Teams with no services", value: o.idleTeams, of: teams.error ? undefined : (teams.data?.length ?? 0) },
              { label: "Teams that own services", value: o.teams.filter((t) => t.services.length > 0).length },
            ]}
          />

          <Section title="Needs an owner" note={o.needsOwner.length}>
            {o.needsOwner.length === 0 ? (
              <Empty>Every service belongs to a team of the organization.</Empty>
            ) : (
              <Panel>
                <ul aria-label="Needs an owner">
                  {o.needsOwner.map((n) => (
                    <li key={n.service} className={row}>
                      <span aria-hidden="true" className="w-[3px] self-stretch rounded-[2px] bg-warn-dot" />
                      <div className="min-w-0">
                        <NameLink href={`/services/${n.service}`}>{n.service}</NameLink>
                        <div className="mt-px text-[12.5px] text-fg-3">
                          {n.team ? (
                            <>
                              Its team <span className="font-mono">{n.team}</span> is not a team of the organization on GitHub.
                            </>
                          ) : (
                            "No team is named."
                          )}
                        </div>
                      </div>
                      <ChangeOwner service={n.service} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>

          <Section title="Teams" note={o.teams.length}>
            <TableFrame label="Teams">
              <thead>
                <tr>
                  <th className={th}>Team</th>
                  <th className={th}>Services</th>
                  <th className={th}>Last deploy</th>
                  <th className={th}>
                    <span className="sr-only">Notes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.teams.map((t) => (
                  <tr key={t.slug} className={tr}>
                    <td className={td}>
                      <span className="font-mono text-[13.5px] font-medium">{t.slug}</span>
                      {t.displayName && t.displayName !== t.slug ? <div className="text-[12.5px] text-fg-3">{t.displayName}</div> : null}
                    </td>
                    <td className={`${td} whitespace-normal`}>
                      {t.services.length === 0 ? (
                        <span className="text-fg-3">None</span>
                      ) : (
                        t.services.map((s, i) => (
                          <span key={s}>
                            {i > 0 ? ", " : null}
                            <NameLink href={`/services/${s}`} className="!text-[12.5px]">
                              {s}
                            </NameLink>
                          </span>
                        ))
                      )}
                    </td>
                    <td className={`${td} text-fg-3`}>{t.lastDeploy ? timeAgo(t.lastDeploy) : "–"}</td>
                    <td className={`${td} text-right`}>
                      {!t.onGitHub ? (
                        <StatusBadge status={{ tone: "warning", word: "Not on GitHub" }} />
                      ) : t.services.length === 0 ? (
                        <StatusBadge status={{ tone: "neutral", word: "No services yet" }} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>

          {o.noContacts.length > 0 ? (
            <p className="text-[12.5px] text-fg-3">
              No contacts named for {o.noContacts.join(", ")}. Add them in each service&apos;s settings, or with{" "}
              <span className="font-mono">forge service update &lt;name&gt; --owner &lt;email&gt;</span>.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

// ChangeOwner links to the settings of a service, for whoever may move it to
// another team.
function ChangeOwner({ service }: { service: string }) {
  if (!usePermissions(service).can("service.update.team")) return null;
  return (
    <TextLink href={`/services/${service}#settings`} className="text-[13px]" aria-label={`Change the owner of ${service}`}>
      Change owner
    </TextLink>
  );
}
