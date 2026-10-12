import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { AuditEventSchema } from "@/gen/forge/v1/audit_pb";
import { ServiceSchema } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentSchema } from "@/gen/forge/v1/environment_pb";
import { OperationSchema } from "@/gen/forge/v1/operation_pb";
import { TeamSchema } from "@/gen/forge/v1/team_pb";
import { deployRows, matchesDeploy } from "./deployments";
import { envSummary, previewLife } from "./environments";
import { recentDeploys } from "./overview";
import { ownership } from "./ownership";
import { filterJumps, jumpItems } from "./palette";

const NOW = new Date(2026, 9, 12, 15, 0, 0);
const ago = (minutes: number) => timestampFromDate(new Date(NOW.getTime() - minutes * 60_000));

describe("the deployments list", () => {
  const outcome = (id: number, action: string, code: string, extra: object = {}) =>
    create(AuditEventSchema, {
      name: `auditEvents/${id}`,
      time: ago(id * 10),
      action,
      kind: "outcome",
      service: "services/payments",
      target: "deployments/payments/staging",
      operation: `operations/op_${id}`,
      actor: { kind: "workload", repository: "showmino/payments" },
      result: { code, message: code === "ok" ? "" : "ci_failed: tests" },
      ...extra,
    });

  it("puts running work first, then what ended, with who asked and for what", () => {
    const recent = recentDeploys([
      outcome(1, "deploy.start", "ok", { details: { ref: "main" } }),
      outcome(2, "deploy.rollback", "failed", { target: "deployments/payments/production", details: { to: "0123456789abcdef0123" }, actor: { kind: "user", email: "ana@example.com" } }),
      outcome(3, "deploy.promote", "ok", { target: "deployments/payments/production" }),
    ]);
    const running = [
      create(OperationSchema, { name: "operations/op_9", kind: "deploy", target: "deployments/ledger/staging", creator: "bo@example.com", events: [{ step: "resolve", message: "main is 5235eea" }, { step: "image" }] }),
      // Not a deploy: a preview being made.
      create(OperationSchema, { name: "operations/op_8", kind: "create_environment", target: "environments/pr-1" }),
    ];
    const rows = deployRows(running, recent);
    expect(rows.map((r) => `${r.kind} ${r.service}→${r.env} ${r.pipeline.state} by ${r.by} ref ${r.ref || "-"}`)).toEqual([
      "deploy ledger→staging running by bo@example.com ref 5235eea",
      "deploy payments→staging succeeded by showmino/payments ref main",
      "rollback payments→production failed by ana@example.com ref 0123456",
      "promote payments→production succeeded by showmino/payments ref -",
    ]);
    expect(rows.filter((r) => matchesDeploy(r, "running")).map((r) => r.service)).toEqual(["ledger"]);
    expect(rows.filter((r) => matchesDeploy(r, "failed")).map((r) => r.kind)).toEqual(["rollback"]);
    expect(rows.filter((r) => matchesDeploy(r, "succeeded"))).toHaveLength(2);
  });
});

describe("an environment across the catalog", () => {
  const dep = (service: string, env: string, over: object = {}) =>
    create(DeploymentSchema, { name: `deployments/${service}/${env}`, service: `services/${service}`, env, commit: "abc1234", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, ...over });

  it("counts what runs there and names what is not healthy", () => {
    const all = [
      dep("payments", "staging"),
      dep("ledger", "staging", { health: Deployment_Health.DEGRADED }),
      dep("web", "staging", { health: Deployment_Health.PROGRESSING }),
      // Never deployed: it does not count.
      dep("docs", "staging", { commit: "", health: Deployment_Health.MISSING }),
      dep("payments", "production"),
    ];
    const staging = envSummary(all, "staging");
    expect(staging).toMatchObject({ deployed: 3, healthy: 1, needsLook: ["ledger", "web"] });
    expect(staging.status.word).toBe("Degraded");
    expect(envSummary(all, "production").status.word).toBe("Healthy");
    expect(envSummary([], "production").status.word).toBe("Nothing deployed");
  });

  it("says how long a preview has left", () => {
    const preview = (created: number, ends: number) => create(EnvironmentSchema, { createTime: ago(created), expireTime: ago(-ends) });
    expect(previewLife(preview(60, 180), NOW)).toEqual({ share: 0.75, words: "ends in 3 h", soon: true });
    expect(previewLife(preview(60, 47 * 60), NOW)?.soon).toBe(false);
    expect(previewLife(preview(60, -5), NOW)).toEqual({ share: 0, words: "ending now", soon: true });
    expect(previewLife(create(EnvironmentSchema, {}), NOW)).toBeNull();
  });
});

describe("ownership", () => {
  const svc = (id: string, team: string, owners: string[] = ["ana@example.com"]) => create(ServiceSchema, { name: `services/${id}`, ownerTeam: team, owners });
  const teams = [
    create(TeamSchema, { name: "teams/platform-engineering", displayName: "Platform Engineering" }),
    create(TeamSchema, { name: "teams/billing", displayName: "Billing" }),
  ];
  const services = [svc("payments", "platform-engineering"), svc("forge-web", "platform-engineering", []), svc("ledger", "finance"), svc("orphan", "")];
  const deployments = [
    create(DeploymentSchema, { service: "services/payments", deployTime: ago(90) }),
    create(DeploymentSchema, { service: "services/forge-web", deployTime: ago(5) }),
  ];

  it("joins the catalog with the organization's teams", () => {
    const o = ownership(services, teams, deployments);
    expect(o.teams.map((t) => `${t.slug}:${t.services.join(",")}:${t.onGitHub}`)).toEqual([
      "platform-engineering:payments,forge-web:true",
      "finance:ledger:false",
      "billing::true",
    ]);
    expect(o.teams[0].lastDeploy?.getTime()).toBe(NOW.getTime() - 5 * 60_000);
    expect(o.needsOwner).toEqual([
      { service: "ledger", team: "finance" },
      { service: "orphan", team: "" },
    ]);
    expect(o.noContacts).toEqual(["forge-web"]);
    expect(o).toMatchObject({ owned: 2, total: 4, idleTeams: 1 });
  });

  it("takes every named team at its word when GitHub cannot be asked", () => {
    const o = ownership(services, null, deployments);
    expect(o.needsOwner).toEqual([{ service: "orphan", team: "" }]);
    expect(o.teams.every((t) => t.onGitHub)).toBe(true);
    expect(o.idleTeams).toBe(0);
  });
});

describe("the command palette", () => {
  const items = jumpItems(
    [create(ServiceSchema, { name: "services/payments", ownerTeam: "billing" }), create(ServiceSchema, { name: "services/forge-web" })],
    [create(EnvironmentSchema, { name: "environments/pr-42", service: "services/payments" })],
  );

  it("finds pages, services and previews, names that start with the query first", () => {
    // A preview is found by its service too.
    expect(filterJumps(items, "pay").map((i) => i.label)).toEqual(["payments", "pr-42"]);
    expect(filterJumps(items, "pr-42")[0]).toMatchObject({ href: "/services/payments", kind: "Preview · payments" });
    expect(filterJumps(items, "billing").map((i) => i.label)).toEqual(["payments"]);
    expect(filterJumps(items, "serv").map((i) => i.label)).toEqual(["Services", "Create service", "payments", "forge-web"]);
    expect(filterJumps(items, "")).toHaveLength(9);
    expect(filterJumps(items, "zzz")).toEqual([]);
  });
});
