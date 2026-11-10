import type { AdoptionPeriod } from "@/gen/forge/v1/audit_pb";
import type { Service, ServiceChecks } from "@/gen/forge/v1/catalog_pb";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
import { type Resource, Resource_State } from "@/gen/forge/v1/resource_pb";
import type { Team } from "@/gen/forge/v1/team_pb";
import { serviceId } from "@/lib/api";
import { catalogRows, offGoldenPath } from "@/lib/catalog";
import { ownership } from "@/lib/ownership";

// The Adoption page: is Forge used, and where are teams stuck.

// change words how a number moved against the period before: "+40%", "−10%",
// "new" when there was nothing before, "" when there is nothing at all.
export function change(now: number, before: number): string {
  if (before === 0) return now > 0 ? "new" : "";
  const pct = Math.round((100 * (now - before)) / before);
  return pct >= 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

// selfServed is the share of people's changes made by members outside the
// admin groups, in percent; null when no change recorded a role.
export function selfServed(p: AdoptionPeriod | undefined): number | null {
  if (!p || p.writes === 0) return null;
  return Math.round((100 * p.selfServed) / p.writes);
}

export type Stuck = { key: string; tone: "bad" | "warn"; title: string; detail: string; href: string; action: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// stuck lists where adoption is stuck: teams that never shipped a service,
// services that fail, services off the golden path, teams nobody pages, and
// resources that are not ready. Whatever is not known yet is left out.
export function stuck(
  services: Service[],
  teams: Team[] | undefined,
  deployments: Deployment[],
  checks: ServiceChecks[] | undefined,
  resources: Resource[] | undefined,
): Stuck[] {
  const out: Stuck[] = [];
  const o = teams ? ownership(services, teams, deployments) : null;
  const idle = o ? o.teams.filter((t) => t.onGitHub && t.services.length === 0).map((t) => t.slug) : [];
  if (idle.length) {
    out.push({ key: "idle", tone: "warn", title: `${plural(idle.length, "team")} never shipped a service`, detail: `${idle.join(", ")}: members, but nothing in the catalog.`, href: "/ownership", action: "Review teams" });
  }
  const failing = catalogRows(services, deployments).filter((r) => r.severity === "bad");
  if (failing.length) {
    out.push({ key: "failing", tone: "bad", title: `${plural(failing.length, "service")} failing`, detail: `${failing.map((r) => r.id).join(", ")}. Failing deploys push people back to doing it by hand.`, href: "/services?status=attention", action: "Open them" });
  }
  if (checks) {
    const off = [...offGoldenPath(checks)];
    if (off.length) {
      out.push({ key: "offpath", tone: "warn", title: `${plural(off.length, "service")} off the golden path`, detail: `${off.length} of ${checks.length} services miss CI, an SLO, tracing, a runbook or on-call.`, href: "/services?status=offpath", action: "See services" });
    }
  }
  if (o && o.noOncall.length) {
    out.push({ key: "oncall", tone: "warn", title: `${plural(o.noOncall.length, "team")} without on-call`, detail: `${o.noOncall.join(", ")}: nobody is paged when their services break.`, href: "/ownership", action: "Set up on-call" });
  }
  const notReady = (resources ?? []).filter((r) => r.state !== Resource_State.READY);
  if (notReady.length) {
    out.push({ key: "resources", tone: "warn", title: `${plural(notReady.length, "resource")} not ready`, detail: `${notReady.map((r) => `${serviceId(r.service)}/${r.name.split("/").pop()}`).join(", ")}.`, href: "/resources", action: "Review resources" });
  }
  return out;
}
