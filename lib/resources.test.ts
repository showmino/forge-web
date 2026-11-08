import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { Resource_State, ResourcePlan_State, ResourcePlanSchema, ResourceSchema, ResourceSettingsSchema } from "@/gen/forge/v1/resource_pb";
import { applicable, busy, changeSummary, changeText, destructive, healthText, planStatus, resourceStatus, settingsText } from "./resources";

const db = create(ResourceSettingsSchema, { name: "db", type: "postgres", storageGi: 10, instances: 1 });
const later = timestampFromDate(new Date(Date.now() + 3600_000));
const earlier = timestampFromDate(new Date(Date.now() - 60_000));

const plan = (over: Record<string, unknown> = {}) =>
  create(ResourcePlanSchema, { name: "resourcePlans/7f3a91c2b04e", service: "services/payments", env: "staging", state: ResourcePlan_State.PLANNED, expireTime: later, ...over });

describe("settings and changes", () => {
  it("says a resource's settings in a few words", () => {
    expect(settingsText(db)).toBe("postgres, 10 Gi, 1 instance");
    expect(settingsText(create(ResourceSettingsSchema, { type: "postgres", instances: 3 }))).toBe("postgres, 3 instances");
    expect(settingsText(undefined)).toBe("–");
  });

  it("says what each change does", () => {
    expect(changeText({ action: "create", resource: "db", type: "postgres", after: db } as never)).toBe("create db (postgres, 10 Gi, 1 instance)");
    expect(changeText({ action: "delete", resource: "db", type: "postgres", before: db } as never)).toBe("delete db (postgres, 10 Gi, 1 instance)");
    expect(changeText({ action: "update", resource: "db", type: "postgres", before: db, after: { ...db, storageGi: 20 } } as never)).toBe(
      "update db: postgres, 10 Gi, 1 instance → postgres, 20 Gi, 1 instance",
    );
  });

  it("counts a plan's changes as the CLI does", () => {
    expect(changeSummary(plan())).toBe("No changes");
    expect(changeSummary(plan({ changes: [{ action: "create", resource: "a" }, { action: "delete", resource: "b" }] }))).toBe("+1 ~0 -1");
    expect(changeSummary(plan({ changes: [{ action: "replace", resource: "a" }] }))).toBe("+0 ~0 -0 ±1");
  });

  it("names the resources a plan deletes or replaces", () => {
    expect(destructive(plan({ changes: [{ action: "create", resource: "a" }, { action: "delete", resource: "b" }, { action: "replace", resource: "c" }] }))).toEqual(["b", "c"]);
  });
});

describe("whether a plan can be applied", () => {
  const change = { changes: [{ action: "create", resource: "db" }] };

  it("is ready only while planned, allowed and not expired", () => {
    expect(applicable(plan(change))).toBe(true);
    expect(planStatus(plan())).toEqual({ tone: "success", word: "Ready to apply" });
    expect(applicable(plan({ ...change, expireTime: earlier }))).toBe(false);
    expect(planStatus(plan({ expireTime: earlier })).word).toBe("Expired");
    expect(applicable(plan({ ...change, policy: { denied: true, deny: ["no"] } }))).toBe(false);
    expect(applicable(plan({ ...change, state: ResourcePlan_State.APPLIED }))).toBe(false);
    expect(planStatus(plan({ state: ResourcePlan_State.APPLY_FAILED }))).toEqual({ tone: "danger", word: "Apply failed" });
  });
});

describe("a resource's state", () => {
  const resource = (over: Record<string, unknown>) => create(ResourceSchema, { name: "resources/payments/staging/db", state: Resource_State.READY, ...over });

  it("is healthy when every instance is ready", () => {
    const r = resource({ health: { phase: "Cluster in healthy state", readyInstances: 2, instances: 2 } });
    expect(resourceStatus(r)).toEqual({ tone: "success", word: "Healthy" });
    expect(healthText(r)).toBe("2/2 ready, Cluster in healthy state");
  });

  it("is degraded when some are not, and unknown when the cluster cannot say", () => {
    expect(resourceStatus(resource({ health: { phase: "Waiting", readyInstances: 1, instances: 2 } })).word).toBe("Degraded");
    expect(resourceStatus(resource({ health: { phase: "unknown" } })).word).toBe("Unknown");
    expect(healthText(resource({ health: { phase: "unknown" } }))).toBe("–");
  });

  it("follows the last apply first", () => {
    expect(resourceStatus(resource({ state: Resource_State.APPLYING })).word).toBe("Applying");
    expect(resourceStatus(resource({ state: Resource_State.FAILED })).word).toBe("Failed");
  });
});

describe("a plan with no changes", () => {
  it("has nothing to apply, unless it repairs Forge's records", () => {
    expect(applicable(plan())).toBe(false);
    expect(applicable(plan({ message: "Forge's records differ from what exists: apply this plan to put them right." }))).toBe(true);
  });
});

describe("whether the tab should look again soon", () => {
  it("is busy while a plan or a resource is moving", () => {
    expect(busy([plan()], [])).toBe(false);
    expect(busy([plan({ state: ResourcePlan_State.APPLYING })], [])).toBe(true);
    expect(busy([], [create(ResourceSchema, { state: Resource_State.DELETING })])).toBe(true);
    expect(busy(undefined, undefined)).toBe(false);
  });
});
