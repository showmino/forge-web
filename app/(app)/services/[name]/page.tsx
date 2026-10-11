"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { useApi } from "@/components/providers";
import { TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, StatusBadge } from "@/components/ui/status";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { shortCommit, timeUntil, when } from "@/lib/format";
import { deploymentStatus, environmentStatus, lifecycleWord } from "@/lib/status";

// One service: who owns it, what runs in staging and production, its previews and its recent history.
export default function ServicePage() {
  const { name: id } = useParams<{ name: string }>();
  const name = `services/${id}`;
  const api = useApi();
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

  if (service.isPending) return <Loading what="the service" />;
  if (service.error) return <ErrorNote error={service.error} />;
  const s = service.data;
  if (!s) return <ErrorNote error={new Error("This service does not exist, or it was removed.")} />;

  return (
    <>
      <PageHeader title={s.displayName || id} lead={<span className="type-code">{id}</span>} />

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
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </Section>

      <Section title="Previews">
        {previews.isPending ? (
          <Loading what="previews" />
        ) : previews.error ? (
          <ErrorNote error={previews.error} />
        ) : previews.data.length === 0 ? (
          <Empty>
            No previews. Create one of any branch with{" "}
            <code className="type-code">forge env create &lt;name&gt; --service {id}</code>.
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
              </tr>
            </thead>
            <tbody>
              {previews.data.map((e) => (
                <tr key={e.name} className={tr}>
                  <td className={td}>
                    <EnvTag kind="preview" name={e.name.replace(/^environments\//, "")} />
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
    </>
  );
}
