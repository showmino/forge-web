import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AdoptionPeriodSchema } from "@/gen/forge/v1/audit_pb";
import { ServiceChecksSchema, ServiceSchema } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { Resource_State, ResourceSchema } from "@/gen/forge/v1/resource_pb";
import { TeamSchema } from "@/gen/forge/v1/team_pb";
import { change, selfServed, stuck } from "./adoption";

describe("adoption", () => {
  it("words how a number moved", () => {
    expect(change(165, 118)).toBe("+40%");
    expect(change(90, 100)).toBe("−10%");
    expect(change(3, 0)).toBe("new");
    expect(change(0, 0)).toBe("");
  });

  it("gives the self-service share only when roles were recorded", () => {
    expect(selfServed(create(AdoptionPeriodSchema, { writes: 4, selfServed: 3 }))).toBe(75);
    expect(selfServed(create(AdoptionPeriodSchema, {}))).toBeNull();
  });

  it("lists where adoption is stuck", () => {
    const services = [
      create(ServiceSchema, { name: "services/payments", ownerTeam: "billing" }),
      create(ServiceSchema, { name: "services/search", ownerTeam: "discovery" }),
    ];
    const teams = [
      create(TeamSchema, { name: "teams/billing", oncall: "billing-primary" }),
      create(TeamSchema, { name: "teams/discovery" }),
      create(TeamSchema, { name: "teams/mobile" }),
    ];
    const deployments = [
      create(DeploymentSchema, { name: "deployments/search/production", service: "services/search", env: "production", commit: "a", health: Deployment_Health.DEGRADED, sync: Deployment_SyncStatus.SYNCED }),
    ];
    const checks = [create(ServiceChecksSchema, { service: "services/payments", passed: 5, applies: 5 }), create(ServiceChecksSchema, { service: "services/search", passed: 2, applies: 5 })];
    const resources = [create(ResourceSchema, { name: "resources/search/staging/index", service: "services/search", state: Resource_State.FAILED })];
    const got = stuck(services, teams, deployments, checks, resources);
    expect(got.map((s) => s.title)).toEqual([
      "1 team never shipped a service",
      "1 service failing",
      "1 service off the golden path",
      "1 team without on-call",
      "1 resource not ready",
    ]);
    expect(got[0].detail).toContain("mobile");
    expect(got[3].detail).toContain("discovery");
    expect(got[4].detail).toContain("search/index");
    // Without the teams and the checks, what they tell is left out.
    expect(stuck(services, undefined, deployments, undefined, []).map((s) => s.key)).toEqual(["failing"]);
  });
});
