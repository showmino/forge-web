"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote, Panel } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { Lifecycle, type Service } from "@/gen/forge/v1/catalog_pb";
import { serviceId, teamId } from "@/lib/api";
import { lifecycleWord } from "@/lib/status";

const LIFECYCLES = [Lifecycle.EXPERIMENTAL, Lifecycle.PRODUCTION, Lifecycle.DEPRECATED];

// contacts reads "a@x.com, b@x.com" as a list, without blanks or repeats.
export function contacts(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
}

type Change = { team: string; owners: string[]; lifecycle: Lifecycle };

// changes names what differs from the service, as update_mask paths and as the CLI's flags.
export function changes(s: Service, next: Change): { paths: string[]; flags: string[] } {
  const paths: string[] = [];
  const flags: string[] = [];
  if (next.team !== s.ownerTeam) {
    paths.push("owner_team");
    flags.push(`--team ${next.team}`);
  }
  if (next.owners.join(",") !== s.owners.join(",")) {
    paths.push("owners");
    flags.push(`--owner ${next.owners.length ? next.owners.join(",") : '""'}`);
  }
  if (next.lifecycle !== s.lifecycle) {
    paths.push("lifecycle");
    flags.push(`--lifecycle ${lifecycleWord(next.lifecycle).toLowerCase()}`);
  }
  return { paths, flags };
}

// ServiceSettings changes who owns a service and where it is in its life. The
// etag of the service as the page read it goes along, so a change someone
// else made meanwhile is not overwritten. Moving a service to another team and
// pointing it at another repo are an admin's: canMoveTeam and canChangeRepo
// say whether the caller is one (the API decides all the same).
export function ServiceSettings({ service, canMoveTeam = true, canChangeRepo = true }: { service: Service; canMoveTeam?: boolean; canChangeRepo?: boolean }) {
  // A saved change gives the service a new etag: the form starts again from it.
  return <SettingsForm key={service.etag} service={service} canMoveTeam={canMoveTeam} canChangeRepo={canChangeRepo} />;
}

function SettingsForm({ service: s, canMoveTeam, canChangeRepo }: { service: Service; canMoveTeam: boolean; canChangeRepo: boolean }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const id = serviceId(s.name);
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.teams.listTeams({}).then((r) => r.teams) });
  const [team, setTeam] = useState(s.ownerTeam);
  const [owners, setOwners] = useState(s.owners.join(", "));
  const [lifecycle, setLifecycle] = useState(s.lifecycle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = { team: team.trim(), owners: contacts(owners), lifecycle };
  const { paths, flags } = changes(s, next);
  const command = `forge service update ${id}${flags.length ? " " + flags.join(" ") : ""}`;
  const slugs = (teams.data ?? []).map((t) => teamId(t.name));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!paths.length || !next.team) return;
    setBusy(true);
    setError(null);
    api.catalog
      .updateService({
        service: { name: s.name, etag: s.etag, ownerTeam: next.team, owners: next.owners, lifecycle: next.lifecycle },
        updateMask: { paths },
      })
      .then(
        (res) => {
          if (res.service) queries.setQueryData(["service", id], res.service);
          void queries.invalidateQueries({ queryKey: ["services"] });
          toast(`Settings saved for ${id}`, command);
        },
        (err: unknown) => {
          setError(err);
          setBusy(false);
        },
      );
  }

  return (
    <Panel>
      <section aria-label="General" className="contents">
        <div className="px-4 pb-3 pt-4">
          <h2 className="type-heading">General</h2>
        </div>
        <form onSubmit={save} className="flex flex-col gap-4 px-4 pb-4">
          {!canMoveTeam ? (
            <Field id="settings-team" label="Owning team" hint="Only an admin can move a service to another team.">
              <input
                id="settings-team"
                className={`${inputClass} bg-surface-2 font-mono text-fg-2`}
                value={s.ownerTeam || "No team"}
                readOnly
                aria-describedby="settings-team-note"
              />
            </Field>
          ) : teams.error ? (
            <Field id="settings-team" label="Owning team" hint="The GitHub team that owns the service, by its name on GitHub.">
              <input id="settings-team" className={`${inputClass} font-mono`} value={team} onChange={(e) => setTeam(e.target.value)} aria-describedby="settings-team-note" />
            </Field>
          ) : (
            <Field id="settings-team" label="Owning team" hint="The GitHub team that answers for the service.">
              <select
                id="settings-team"
                className={inputClass}
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                disabled={teams.isPending}
                aria-describedby="settings-team-note"
              >
                {teams.isPending ? <option value={team}>Loading the teams from GitHub</option> : null}
                {!teams.isPending && !slugs.includes(s.ownerTeam) ? (
                  <option value={s.ownerTeam}>{s.ownerTeam ? `${s.ownerTeam} (not a team on GitHub)` : "No team"}</option>
                ) : null}
                {(teams.data ?? []).map((t) => {
                  const slug = teamId(t.name);
                  return (
                    <option key={t.name} value={slug}>
                      {t.displayName && t.displayName !== slug ? `${slug} (${t.displayName})` : slug}
                    </option>
                  );
                })}
              </select>
            </Field>
          )}
          <Field id="settings-contacts" label="Contacts" hint="Who to ask about the service. Separate several with commas.">
            <input
              id="settings-contacts"
              className={inputClass}
              value={owners}
              onChange={(e) => setOwners(e.target.value)}
              aria-describedby="settings-contacts-note"
              placeholder="ana@example.com"
            />
          </Field>
          <Field id="settings-lifecycle" label="Lifecycle">
            <select id="settings-lifecycle" className={inputClass} value={lifecycle} onChange={(e) => setLifecycle(Number(e.target.value) as Lifecycle)}>
              {lifecycle === Lifecycle.UNSPECIFIED ? <option value={Lifecycle.UNSPECIFIED}>Not set</option> : null}
              {LIFECYCLES.map((l) => (
                <option key={l} value={l}>
                  {lifecycleWord(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="settings-repo" label="Repository" hint={canChangeRepo ? `Change it with forge service update ${id} --repo <url>.` : "Only an admin can point the service at another repository."}>
            <input id="settings-repo" className={`${inputClass} bg-surface-2 font-mono text-fg-2`} value={s.repoUrl || "–"} readOnly aria-describedby="settings-repo-note" />
          </Field>
          <Cli command={command} />
          {error ? <ErrorNote error={error} /> : null}
          <div>
            <Button kind="primary" type="submit" disabled={busy || !paths.length || !next.team}>
              Save changes
            </Button>
          </div>
        </form>
      </section>
    </Panel>
  );
}
