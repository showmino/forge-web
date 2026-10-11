import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentSchema } from "@/gen/forge/v1/environment_pb";
import { auditStatus, deploymentStatus, environmentStatus } from "./status";

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
