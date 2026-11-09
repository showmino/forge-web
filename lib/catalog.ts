import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Service } from "@/gen/forge/v1/catalog_pb";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
import { serviceId } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { severity, type Severity } from "@/lib/overview";
import { deploymentStatus, NOT_DEPLOYED, type Status } from "@/lib/status";

// The Catalog's table and the home page's service cards: one row per
// service, showing the environment where it hurts most.

export type CatalogRow = {
  id: string;
  service: Service;
  team: string;
  // The environment the row shows: the one with a problem, else production,
  // else staging; "" when the service runs nowhere.
  env: "production" | "staging" | "";
  status: Status;
  severity: Severity;
  // When the shown environment was last deployed: "31 min ago", or "".
  when: string;
  // Staging runs another commit than production and is healthy: a promote is waiting.
  ahead: boolean;
};

function find(deployments: Deployment[], name: string, env: string): Deployment | undefined {
  return deployments.find((d) => d.service === name && d.env === env);
}

const hurts = (s: Severity) => s === "bad" || s === "warn";

// rank orders services the way someone fixing things reads them: production
// broken, staging broken, production out of sync, staging out of sync, then
// the healthy ones, and last what runs nowhere.
function rank(prod: Severity, stg: Severity): number {
  if (prod === "bad") return 0;
  if (stg === "bad") return 1;
  if (prod === "warn") return 2;
  if (stg === "warn") return 3;
  if (prod === "none" && stg === "none") return 5;
  return 4;
}

export function catalogRows(services: Service[], deployments: Deployment[], now = new Date()): CatalogRow[] {
  const rows = services.map((service) => {
    const prod = find(deployments, service.name, "production");
    const stg = find(deployments, service.name, "staging");
    const p = severity(prod);
    const s = severity(stg);
    const env: CatalogRow["env"] = hurts(p) ? "production" : hurts(s) ? "staging" : p !== "none" ? "production" : s !== "none" ? "staging" : "";
    const shown = env === "production" ? prod : env === "staging" ? stg : undefined;
    const at = shown?.deployTime ? timestampDate(shown.deployTime) : undefined;
    return {
      row: {
        id: serviceId(service.name),
        service,
        team: service.ownerTeam,
        env,
        status: shown ? deploymentStatus(shown) : NOT_DEPLOYED,
        severity: env === "production" ? p : env === "staging" ? s : "none",
        when: at ? timeAgo(at, now) : "",
        ahead: !!prod?.commit && !!stg?.commit && prod.commit !== stg.commit && s === "ok",
      } satisfies CatalogRow,
      rank: rank(p, s),
    };
  });
  rows.sort((a, b) => a.rank - b.rank || a.row.id.localeCompare(b.row.id));
  return rows.map((r) => r.row);
}

export type StatusFilter = "all" | "attention" | "healthy" | "ahead";

export type CatalogFilter = { query: string; team: string; status: StatusFilter };

// filterRows keeps the rows that match the search (name, display name, team)
// and the owner and status filters.
export function filterRows(rows: CatalogRow[], f: CatalogFilter): CatalogRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.id} ${r.service.displayName} ${r.team}`.toLowerCase().includes(q)) return false;
    if (f.team !== "all" && r.team !== f.team) return false;
    switch (f.status) {
      case "attention":
        return hurts(r.severity);
      case "healthy":
        return r.severity === "ok";
      case "ahead":
        return r.ahead;
      default:
        return true;
    }
  });
}

// teamsOf lists the owning teams in the catalog, by name.
export function teamsOf(services: Service[]): string[] {
  return [...new Set(services.map((s) => s.ownerTeam).filter(Boolean))].sort();
}

// newThisWeek counts the services created in the last week.
export function newThisWeek(services: Service[], now = new Date()): number {
  const week = 7 * 24 * 3600_000;
  return services.filter((s) => s.createTime && now.getTime() - timestampDate(s.createTime).getTime() < week).length;
}
