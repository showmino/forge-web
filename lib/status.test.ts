import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { Approval_State, ApprovalSchema } from "@/gen/forge/v1/approval_pb";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentSchema } from "@/gen/forge/v1/environment_pb";
import { OperationSchema } from "@/gen/forge/v1/operation_pb";
import { approvalStatus, auditStatus, deploymentStatus, environmentStatus, operationStatus, operationTitle } from "./status";

describe("deploymentStatus", () => {
  const d = (health: Deployment_Health, sync = Deployment_SyncStatus.SYNCED) => create(DeploymentSchema, { health, sync });

  it.each([
    [d(Deployment_Health.HEALTHY), "success", "Healthy"],
    [d(Deployment_Health.HEALTHY, Deployment_SyncStatus.OUT_OF_SYNC), "warning", "Out of sync"],
    [d(Deployment_Health.PROGRESSING), "progress", "Syncing"],
    [d(Deployment_Health.DEGRADED), "warning", "Degraded"],
    [d(Deployment_Health.MISSING), "neutral", "Not deployed"],
    [d(Deployment_Health.UNKNOWN), "neutral", "Unknown"],
    [undefined, "neutral", "Not deployed"],
  ])("%#: %s %s", (deployment, tone, word) => {
    expect(deploymentStatus(deployment)).toEqual({ tone, word });
  });
});

describe("environmentStatus", () => {
  it.each([
    [Environment_State.CREATING, "progress", "Creating"],
    [Environment_State.READY, "success", "Ready"],
    [Environment_State.FAILED, "danger", "Failed"],
    [Environment_State.DESTROYING, "progress", "Destroying"],
  ])("%s → %s %s", (state, tone, word) => {
    expect(environmentStatus(create(EnvironmentSchema, { state }))).toEqual({ tone, word });
  });
});

describe("auditStatus", () => {
  it.each([
    ["ok", "success", "OK"],
    [undefined, "success", "OK"],
    ["failed", "danger", "Failed"],
    ["failed_precondition", "danger", "Failed"],
    ["permission_denied", "danger", "Denied"],
    ["unauthenticated", "danger", "Denied"],
    ["canceled", "neutral", "Cancelled"],
  ])("%s → %s %s", (code, tone, word) => {
    expect(auditStatus(code)).toEqual({ tone, word });
  });
});

describe("operations", () => {
  const op = (init: Parameters<typeof create<typeof OperationSchema>>[1]) => create(OperationSchema, init);

  it.each([
    [undefined, "progress", "Running"],
    [op({}), "progress", "Running"],
    [op({ done: true }), "success", "Succeeded"],
    [op({ done: true, error: { code: "cancelled" } }), "neutral", "Cancelled"],
    [op({ done: true, error: { code: "image_timeout" } }), "danger", "Failed"],
  ])("%#: %s %s", (operation, tone, word) => {
    expect(operationStatus(operation)).toEqual({ tone, word });
  });

  it.each([
    ["deploy", "deployments/forge-web/staging", "Deploy forge-web to staging"],
    ["promote", "deployments/forge-web/production", "Promote forge-web to production"],
    ["rollback", "deployments/forge-web/production", "Roll back forge-web in production"],
    ["create_environment", "environments/pr-42", "Create preview pr-42"],
    ["destroy_environment", "environments/pr-42", "Destroy preview pr-42"],
    ["delete_service", "services/force-docs", "Delete force-docs"],
    ["resource.apply", "resources/payments/staging", "Apply resources of payments in staging"],
    ["resource.plan", "resources/payments/production", "Plan resources of payments in production"],
    ["", "", "Operation"],
  ])("%s on %s is %j", (kind, target, want) => {
    expect(operationTitle(op({ kind, target }))).toBe(want);
  });
});

describe("approvalStatus", () => {
  const a = (state: Approval_State, dispatchError = "") => create(ApprovalSchema, { state, dispatchError });
  it("names each state", () => {
    expect(approvalStatus(a(Approval_State.PENDING))).toEqual({ tone: "warning", word: "Waiting" });
    expect(approvalStatus(a(Approval_State.APPROVED))).toEqual({ tone: "progress", word: "Approved" });
    expect(approvalStatus(a(Approval_State.CLAIMED))).toEqual({ tone: "success", word: "Deployed" });
    expect(approvalStatus(a(Approval_State.REJECTED))).toEqual({ tone: "danger", word: "Rejected" });
    expect(approvalStatus(a(Approval_State.SUPERSEDED))).toEqual({ tone: "neutral", word: "Superseded" });
  });
  it("says when the run could not start", () => {
    expect(approvalStatus(a(Approval_State.APPROVED, "403"))).toEqual({ tone: "danger", word: "Run not started" });
  });
});
