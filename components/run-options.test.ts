import { describe, expect, it } from "vitest";
import { emptyRunForm, runOptions } from "./run-options";

describe("runOptions", () => {
  const all = ["replicas", "resources", "env", "secrets", "jobs", "autoscaling"];

  it("sends nothing when nothing is filled in", () => {
    expect(runOptions(emptyRunForm, all)).toEqual({ options: undefined, flags: [] });
  });

  it("turns the form into RunOptions and the same forge create flags", () => {
    const { options, flags } = runOptions(
      {
        ...emptyRunForm,
        replicas: " 3 ",
        autoscalingMax: "6",
        requestsCpu: "100m",
        limitsMemory: "512Mi",
        env: [{ name: "LOG_LEVEL", value: "info" }, { name: " ", value: "skipped" }],
        secrets: [{ name: "stripe", item: "vaults/Kube/items/shop-stripe", env: "STRIPE_KEY=credential, STRIPE_HOOK=webhook" }],
        jobs: [{ name: "cleanup", schedule: "0 3 * * *", command: "node  scripts/cleanup.js" }],
      },
      all,
    );
    expect(options).toEqual({
      replicas: 3,
      autoscalingMax: 6,
      resources: { requestsCpu: "100m", requestsMemory: "", limitsCpu: "", limitsMemory: "512Mi" },
      env: { LOG_LEVEL: "info" },
      secrets: [{ name: "stripe", item: "vaults/Kube/items/shop-stripe", env: { STRIPE_KEY: "credential", STRIPE_HOOK: "webhook" } }],
      jobs: [{ name: "cleanup", schedule: "0 3 * * *", command: ["node", "scripts/cleanup.js"] }],
    });
    expect(flags).toEqual([
      ["--replicas", "3"],
      ["--resources", "requests.cpu=100m,limits.memory=512Mi"],
      ["--env", "LOG_LEVEL=info"],
      ["--secret", "stripe=vaults/Kube/items/shop-stripe:STRIPE_KEY=credential,STRIPE_HOOK=webhook"],
      ["--job", "'cleanup=0 3 * * *:node  scripts/cleanup.js'"],
      ["--autoscaling-max", "6"],
    ]);
  });

  it("leaves out what the template does not offer", () => {
    expect(runOptions({ ...emptyRunForm, replicas: "2", autoscalingMax: "4" }, ["replicas"]).options).toEqual({ replicas: 2 });
  });
});
