import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Service } from "@/gen/forge/v1/catalog_pb";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
import type { Team } from "@/gen/forge/v1/team_pb";
import { serviceId, teamId } from "@/lib/api";

// Ownership: which GitHub team answers for each service. A service's owner is
// the team's slug; the CLI accepts any name, so some may not be a team at all.

export type TeamRow = {
  slug: string;
  displayName: string;
  services: string[];
  // The newest deploy of any of its services.
  lastDeploy: Date | undefined;
  // False for a name services use that is not a team of the organization.
  onGitHub: boolean;
};

export type NeedsOwner = { service: string; team: string };

export type Ownership = {
  teams: TeamRow[];
  needsOwner: NeedsOwner[];
  // Services with nobody named as a contact.
  noContacts: string[];
  owned: number;
  total: number;
  idleTeams: number;
};

// ownership joins the catalog with the organization's teams. teams is null
// when the API could not read them: every named team then counts as owned.
export function ownership(services: Service[], teams: Team[] | null, deployments: Deployment[]): Ownership {
  const rows = new Map<string, TeamRow>();
  for (const t of teams ?? []) {
    const slug = teamId(t.name);
    rows.set(slug, { slug, displayName: t.displayName, services: [], lastDeploy: undefined, onGitHub: true });
  }
  const latest = new Map<string, Date>();
  for (const d of deployments) {
    if (!d.deployTime) continue;
    const t = timestampDate(d.deployTime);
    const prev = latest.get(d.service);
    if (!prev || t > prev) latest.set(d.service, t);
  }

  const needsOwner: NeedsOwner[] = [];
  const noContacts: string[] = [];
  for (const s of services) {
    const id = serviceId(s.name);
    if (s.owners.length === 0) noContacts.push(id);
    const team = s.ownerTeam.trim();
    if (!team || (teams && !rows.has(team))) {
      needsOwner.push({ service: id, team });
      if (!team) continue;
    }
    let row = rows.get(team);
    if (!row) {
      row = { slug: team, displayName: "", services: [], lastDeploy: undefined, onGitHub: !teams };
      rows.set(team, row);
    }
    row.services.push(id);
    const deployed = latest.get(s.name);
    if (deployed && (!row.lastDeploy || deployed > row.lastDeploy)) row.lastDeploy = deployed;
  }

  const sorted = [...rows.values()].sort((a, b) => b.services.length - a.services.length || a.slug.localeCompare(b.slug));
  return {
    teams: sorted,
    needsOwner,
    noContacts,
    owned: services.length - needsOwner.length,
    total: services.length,
    idleTeams: sorted.filter((t) => t.onGitHub && t.services.length === 0).length,
  };
}
