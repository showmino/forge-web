import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { AuditEventSchema } from "@/gen/forge/v1/audit_pb";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentSchema } from "@/gen/forge/v1/environment_pb";
import { OperationSchema } from "@/gen/forge/v1/operation_pb";
import { attention, board, dayStats, expiringSoon, pipelineOf, recentDeploys, segment, severity, shipping, stageOf, STAGES, worse } from "./overview";

const NOW = new Date(2026, 9, 11, 15, 0, 0);
const ago = (minutes: number) => timestampFromDate(new Date(NOW.getTime() - minutes * 60_000));
const steps = (...names: string[]) => names.map((step) => ({ step }));

describe("the stages of a deploy", () => {
  it("is at the stage after the last one that finished", () => {
    expect(stageOf("deploy", [])).toBe(0);
    expect(stageOf("deploy", steps("resolve", "address"))).toBe(0);
    expect(stageOf("deploy", steps("resolve", "image"))).toBe(1);
    expect(stageOf("deploy", steps("resolve", "image", "release", "commit"))).toBe(3);
    expect(stageOf("deploy", steps("resolve", "image", "release", "commit", "namespace"))).toBe(4);
    expect(stageOf("deploy", steps("resolve", "image", "release", "commit", "namespace", "sync", "sync"))).toBe(4);
  });

  it("starts a promotion at the release and a rollback at the commit", () => {
    expect(stageOf("promote", [])).toBe(1);
    expect(stageOf("promote", steps("address", "release"))).toBe(2);
    expect(stageOf("rollback", [])).toBe(2);
    expect(stageOf("rollback", steps("commit"))).toBe(3);
  });

  it("draws what is done, what is running and where it stopped", () => {
    const draw = (p: { stage: number; state: "running" | "succeeded" | "failed" | "cancelled" }) => STAGES.map((_, i) => segment(p, i) || "-").join(" ");
    expect(draw({ stage: 3, state: "running" })).toBe("done done done active -");
    expect(draw({ stage: 1, state: "failed" })).toBe("done fail - - -");
    expect(draw({ stage: 4, state: "succeeded" })).toBe("done done done done done");
    expect(draw({ stage: 2, state: "cancelled" })).toBe("done done - - -");
  });

  it("reads an operation", () => {
    const op = (over: object) => create(OperationSchema, { kind: "deploy", events: steps("resolve", "image"), ...over });
    expect(pipelineOf(op({}))).toEqual({ stage: 1, state: "running" });
    expect(pipelineOf(op({ done: true }))).toEqual({ stage: 4, state: "succeeded" });
    expect(pipelineOf(op({ done: true, error: { code: "release_failed", message: "no" } }))).toEqual({ stage: 1, state: "failed" });
    expect(pipelineOf(op({ done: true, error: { code: "cancelled" } }))).toEqual({ stage: 1, state: "cancelled" });
  });

  it("finds the version or the commit that is shipping", () => {
    expect(shipping([])).toBe("");
    expect(shipping([{ step: "resolve", message: "main is 5235eea" }])).toBe("5235eea");
    expect(shipping([{ step: "resolve", message: "main is 5235eea" }, { step: "release", message: "release candidate v0.1.2-rc.1 for 5235eea" }])).toBe("v0.1.2-rc.1");
    expect(shipping([{ step: "release", message: "released v1.4.0 for 5235eea" }])).toBe("v1.4.0");
  });
});

const event = (id: number, minutes: number, action: string, kind: string, code: string, extra: object = {}) =>
  create(AuditEventSchema, {
    name: `auditEvents/${id}`,
    time: ago(minutes),
    action,
    kind,
    service: "services/payments",
    target: "deployments/payments/staging",
    result: { code },
    ...extra,
  });

describe("the day in the audit log", () => {
  const events = [
    event(9, 5, "deploy.start", "outcome", "ok"),
    event(8, 9, "deploy.start", "request", "ok"),
    event(7, 30, "deploy.promote", "outcome", "failed", { target: "deployments/payments/production", result: { code: "failed", message: "sync_timeout: Argo CD did not report the application healthy in 10m0s" } }),
    event(6, 41, "deploy.promote", "request", "ok", { target: "deployments/payments/production" }),
    event(5, 50, "deploy.promote", "request", "ok", { target: "deployments/payments/production", details: { validate_only: "true" } }),
    event(4, 60, "deploy.start", "request", "failed_precondition"),
    event(3, 70, "deploy.rollback", "outcome", "cancelled"),
    event(2, 71, "deploy.rollback", "request", "ok"),
    event(1, 80, "service.update", "request", "ok"),
    // Yesterday evening: in the last 24 hours, not today.
    event(0, 17 * 60, "deploy.start", "outcome", "failed", { result: { code: "failed", message: "ci_failed: CI test finished with failure" } }),
  ];

  it("counts what was started today and how it ended", () => {
    // A dry run and a refused request start nothing; a cancelled deploy did not fail.
    expect(dayStats(events, NOW)).toEqual({ started: 3, finished: 3, failed: 1 });
    expect(dayStats([], NOW)).toEqual({ started: 0, finished: 0, failed: 0 });
  });

  it("lists the deploys that ended, with where a failed one stopped", () => {
    const recent = recentDeploys(events);
    expect(recent.map((r) => `${r.kind} ${r.service} ${r.env} ${r.pipeline.state}@${r.pipeline.stage}`)).toEqual([
      "deploy payments staging succeeded@4",
      "promote payments production failed@4",
      "rollback payments staging cancelled@4",
      "deploy payments staging failed@0",
    ]);
    expect(recent[1].note).toBe("Argo CD did not report the application healthy in 10m0s");
    expect(recent[0].note).toBe("");
  });
});

describe("how urgently a deployment needs a look", () => {
  const dep = (over: object) => create(DeploymentSchema, { commit: "abc1234", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, ...over });

  it("grades a deployment", () => {
    expect(severity(undefined)).toBe("none");
    expect(severity(dep({ commit: "" }))).toBe("none");
    // Missing with no commit is never deployed, not broken: nothing to miss yet.
    expect(severity(dep({ commit: "", health: Deployment_Health.MISSING }))).toBe("none");
    expect(severity(dep({}))).toBe("ok");
    expect(severity(dep({ health: Deployment_Health.PROGRESSING }))).toBe("ok");
    expect(severity(dep({ sync: Deployment_SyncStatus.OUT_OF_SYNC, health: Deployment_Health.PROGRESSING }))).toBe("ok");
    expect(severity(dep({ sync: Deployment_SyncStatus.OUT_OF_SYNC }))).toBe("warn");
    expect(severity(dep({ health: Deployment_Health.DEGRADED }))).toBe("bad");
    expect(severity(dep({ health: Deployment_Health.MISSING }))).toBe("bad");
  });

  it("picks the worse of two grades", () => {
    expect(worse("ok", "bad")).toBe("bad");
    expect(worse("warn", "none")).toBe("warn");
    expect(worse("none", "ok")).toBe("ok");
    expect(worse("ok", "ok")).toBe("ok");
  });
});

describe("what needs attention", () => {
  const dep = (env: string, over: object) =>
    create(DeploymentSchema, { name: `deployments/payments/${env}`, service: "services/payments", env, commit: "abc1234", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, ...over });
  const preview = (id: string, over: object) =>
    create(EnvironmentSchema, { name: `environments/${id}`, service: "services/payments", creator: "ana@example.com", state: Environment_State.READY, ...over });

  it("is nothing when all is well", () => {
    expect(attention([dep("staging", {}), dep("production", {})], [preview("pr-1", { expireTime: ago(-24 * 60) })], [], NOW)).toEqual([]);
    // Nothing was ever deployed there: that is not broken.
    expect(attention([dep("production", { commit: "", health: Deployment_Health.MISSING })], [], [], NOW)).toEqual([]);
  });

  it("names what is broken first, then what soon will be", () => {
    const recent = recentDeploys([
      event(3, 5, "deploy.start", "outcome", "ok", { service: "services/ledger", target: "deployments/ledger/staging" }),
      event(2, 30, "deploy.start", "outcome", "failed", { service: "services/ledger", target: "deployments/ledger/staging", result: { code: "failed", message: "ci_failed: tests" } }),
      event(1, 40, "deploy.promote", "outcome", "failed", { target: "deployments/payments/production", result: { code: "failed", message: "sync_timeout: not healthy in 10m0s" } }),
    ]);
    const got = attention(
      [dep("staging", { sync: Deployment_SyncStatus.OUT_OF_SYNC }), dep("production", { health: Deployment_Health.DEGRADED, message: "1 of 2 pods crash" })],
      [preview("pr-388", { expireTime: ago(-125) }), preview("pr-9", { state: Environment_State.FAILED }), preview("pr-7", { expireTime: ago(-600) })],
      recent,
      NOW,
    );
    expect(got.map((a) => `${a.tone}: ${a.before}${a.subject}${a.after} | ${a.detail}`)).toEqual([
      "danger: payments is degraded in production | 1 of 2 pods crash",
      // ledger's later deploy to staging succeeded: its failure is history.
      "danger: The last payments promotion to production failed | not healthy in 10m0s",
      "danger: Preview pr-9 failed | payments · created by ana@example.com",
      "warning: payments is out of sync in staging | What runs is not what the deploy repo says.",
      "warning: Preview pr-388 expires in 2 h | payments · created by ana@example.com",
    ]);
    expect(got[4].extend?.name).toBe("environments/pr-388");
    expect(got[0].href).toBe("/services/payments");
  });

  it("forgets a failed deploy after a day", () => {
    const old = recentDeploys([event(1, 25 * 60, "deploy.start", "outcome", "failed", { result: { code: "failed", message: "ci_failed: tests" } })]);
    expect(attention([], [], old, NOW)).toEqual([]);
  });
});

describe("the status board", () => {
  const dep = (service: string, env: string, over: object = {}) =>
    create(DeploymentSchema, {
      name: `deployments/${service}/${env}`,
      service: `services/${service}`,
      env,
      commit: "4b7d1c0aa9e1",
      health: Deployment_Health.HEALTHY,
      sync: Deployment_SyncStatus.SYNCED,
      deployTime: ago(90),
      ...over,
    });

  it("has a row for production, then staging, with one tile per deployed service", () => {
    const rows = board([dep("ledger", "staging"), dep("payments", "production"), dep("ledger", "production")], 3, NOW);
    expect(rows.map((r) => r.env)).toEqual(["production", "staging"]);
    expect(rows[0].tiles.map((t) => t.service)).toEqual(["ledger", "payments"]);
    expect(rows[1].tiles.map((t) => t.service)).toEqual(["ledger"]);
    // What is not deployed in an environment gets no tile, only a count.
    expect(rows[0].notDeployed).toBe(1);
    expect(rows[1].notDeployed).toBe(2);
  });

  it("puts what is broken first and says what runs on the rest", () => {
    const rows = board(
      [
        dep("identity", "production"),
        dep("checkout-api", "production", { health: Deployment_Health.DEGRADED, deployTime: ago(31) }),
        dep("web", "production", { sync: Deployment_SyncStatus.OUT_OF_SYNC }),
        dep("search", "production", { health: Deployment_Health.MISSING }),
        dep("payments", "production", { version: "v0.4.1", deployTime: ago(26 * 60) }),
        dep("notifications", "production", { health: Deployment_Health.PROGRESSING }),
        dep("never", "production", { commit: "" }),
      ],
      undefined,
      NOW,
    );
    const p = rows[0];
    expect(p.tiles.map((t) => [t.service, t.severity, t.word])).toEqual([
      ["checkout-api", "bad", "Degraded"],
      ["search", "bad", "Not running"],
      ["web", "warn", "Out of sync"],
      ["identity", "ok", "4b7d1c0"],
      ["notifications", "ok", "Progressing"],
      ["payments", "ok", "v0.4.1"],
    ]);
    expect(p.tiles[0].when).toBe("31 min ago");
    expect(p.tiles[0].href).toBe("/services/checkout-api");
    expect(p.unhealthy).toBe(2);
    expect(p.outOfSync).toBe(1);
    // Without the catalog, the board does not guess what is missing.
    expect(p.notDeployed).toBeUndefined();
    expect(rows[1].tiles).toEqual([]);
  });

  it("shows a few tiles however many services there are: what is broken, then what changed last", () => {
    const many = Array.from({ length: 400 }, (_, i) => dep(`svc-${String(i).padStart(3, "0")}`, "production", { deployTime: ago(600 + i) }));
    many.push(
      dep("fresh", "production", { deployTime: ago(5) }),
      dep("rolling", "production", { health: Deployment_Health.PROGRESSING, deployTime: ago(2) }),
      dep("broken", "production", { health: Deployment_Health.DEGRADED, deployTime: ago(900) }),
      dep("drifted", "production", { sync: Deployment_SyncStatus.OUT_OF_SYNC, deployTime: ago(800) }),
    );
    const [p] = board(many, 410, NOW);
    expect(p.tiles.map((t) => t.service)).toEqual(["broken", "drifted", "rolling", "fresh", "svc-000", "svc-001"]);
    expect(p.running).toBe(404);
    expect(p.more).toBe(398);
    expect(p.unhealthy).toBe(1);
    expect(p.outOfSync).toBe(1);
    expect(p.notDeployed).toBe(6);
  });

  it("shows only problems when there are more of them than fit, and counts the rest", () => {
    const broken = Array.from({ length: 9 }, (_, i) => dep(`b${i}`, "staging", { health: Deployment_Health.MISSING }));
    const [, s] = board([...broken, dep("fine", "staging")], undefined, NOW);
    expect(s.tiles.map((t) => t.service)).toEqual(["b0", "b1", "b2", "b3", "b4", "b5"]);
    expect(s.more).toBe(4);
    expect(s.unhealthy).toBe(9);
  });

  it("counts the previews that end within six hours", () => {
    const preview = (id: string, hours: number, state = Environment_State.READY) =>
      create(EnvironmentSchema, { name: `environments/${id}`, state, expireTime: timestampFromDate(new Date(NOW.getTime() + hours * 3_600_000)) });
    expect(expiringSoon([preview("a", 2), preview("b", 30), preview("c", 5.9), preview("d", 1, Environment_State.FAILED), preview("e", -1)], NOW)).toBe(2);
  });
});
