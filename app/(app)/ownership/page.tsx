"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { usePermissions, useRole } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { Button, NameLink, TextLink } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Empty, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Stats } from "@/components/ui/pipeline";
import { StatusBadge } from "@/components/ui/status";
import { listAllServices } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ownership, type TeamRow } from "@/lib/ownership";

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0";

// Which GitHub team answers for each service, and what has no owner.
export default function Ownership() {
  const api = useApi();
  const admin = useRole() === "Admin";
  const [editing, setEditing] = useState<TeamRow | null>(null);
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
              { label: "Teams with services and no on-call", value: o.noOncall.length, of: o.teams.filter((t) => t.onGitHub && t.services.length > 0).length },
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
                  <th className={th}>Members</th>
                  <th className={th}>On-call</th>
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
                    <td className={`${td} tabular-nums`}>{t.members || <span className="text-fg-3">–</span>}</td>
                    <td className={td}>
                      {t.oncall ? <span className="font-mono text-[12.5px]">{t.oncall}</span> : <span className="text-fg-3">None</span>}
                      {admin && t.onGitHub ? (
                        <Button kind="quiet" size="sm" className="ml-1" onClick={() => setEditing(t)} aria-label={`Set the on-call of ${t.slug}`}>
                          {t.oncall ? "Change" : "Set"}
                        </Button>
                      ) : null}
                    </td>
                    <td className={`${td} text-fg-3`}>{t.lastDeploy ? timeAgo(t.lastDeploy) : "–"}</td>
                    <td className={`${td} text-right`}>
                      {!t.onGitHub ? (
                        <StatusBadge status={{ tone: "warning", word: "Not on GitHub" }} />
                      ) : t.services.length === 0 ? (
                        <StatusBadge status={{ tone: "neutral", word: "No services yet" }} />
                      ) : !t.oncall ? (
                        <StatusBadge status={{ tone: "warning", word: "No on-call rotation" }} />
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
      {editing ? <OncallDialog team={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

// OncallDialog sets a team's on-call rotation, as forge team update does. Admins only.
function OncallDialog({ team, onClose }: { team: TeamRow; onClose: () => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const [oncall, setOncall] = useState(team.oncall);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const value = oncall.trim();
  const bad = value !== "" && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(value);
  const command = `forge team update ${team.slug} --oncall ${value || '""'}`;

  function save(e: FormEvent) {
    e.preventDefault();
    if (bad) return;
    setBusy(true);
    setError(null);
    api.teams.updateTeam({ team: { name: `teams/${team.slug}`, oncall: value }, updateMask: { paths: ["oncall"] } }).then(
      () => {
        void queries.invalidateQueries({ queryKey: ["teams"] });
        toast(value ? `${team.slug} is on call as ${value}` : `${team.slug} has no on-call rotation`, command);
        onClose();
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  return (
    <Dialog title={`On-call of ${team.slug}`} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p>Who is paged when the team&apos;s services break: the rotation&apos;s name in your paging tool. Leave it empty to remove it.</p>
        <Field id="oncall-name" label="Rotation" error={bad ? "Use letters, digits, '.', '_', '/' and '-'." : undefined}>
          <input id="oncall-name" className={`${inputClass} font-mono`} value={oncall} onChange={(e) => setOncall(e.target.value)} placeholder={`${team.slug}-primary`} aria-describedby="oncall-name-note" />
        </Field>
        <Cli command={command} />
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={busy || bad || value === team.oncall}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
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
