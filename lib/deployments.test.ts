import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { AuditEventSchema } from "@/gen/forge/v1/audit_pb";
import { type DeployRow, durations, durationText, median, searchDeploys } from "./deployments";

const NOW = new Date(2026, 10, 9, 15, 0, 0);
const at = (minutes: number) => timestampFromDate(new Date(NOW.getTime() - minutes * 60_000));
const event = (operation: string, kind: string, minutes: number) => create(AuditEventSchema, { operation, kind, time: at(minutes) });

const row = (over: Partial<DeployRow>): DeployRow => ({
  key: over.operation ?? "k",
  kind: "deploy",
  service: "payments",
  env: "staging",
  pipeline: { stage: 4, state: "succeeded" },
  time: undefined,
  note: "",
  operation: "operations/a",
  by: "ana@example.com",
  ref: "main",
  running: false,
  ...over,
});

describe("deploy durations", () => {
  it("measures each operation from its request to its outcome", () => {
    const took = durations([event("operations/a", "outcome", 10), event("operations/a", "request", 16), event("operations/b", "request", 2)]);
    expect(took.get("operations/a")).toBe(6 * 60_000);
    // Still running: no outcome yet.
    expect(took.has("operations/b")).toBe(false);
  });

  it("takes the median of the deploys that succeeded", () => {
    const took = new Map([
      ["operations/a", 60_000],
      ["operations/b", 240_000],
      ["operations/c", 120_000],
      ["operations/d", 999_000],
    ]);
    const rows = [
      row({ operation: "operations/a" }),
      row({ operation: "operations/b" }),
      row({ operation: "operations/c" }),
      row({ operation: "operations/d", pipeline: { stage: 2, state: "failed" } }),
    ];
    expect(median(rows, took)).toBe(120_000);
    expect(median([], took)).toBeNull();
  });

  it("says a duration in seconds or minutes", () => {
    expect(durationText(45_000)).toBe("45 s");
    expect(durationText(372_000)).toBe("6 min");
    expect(durationText(null)).toBe("–");
  });
});

describe("searching deploys", () => {
  const rows = [
    row({ operation: "operations/a", service: "payments", env: "production" }),
    row({ operation: "operations/b", service: "ledger", env: "staging", pipeline: { stage: 0, state: "failed" }, note: "CI test finished with failure" }),
    row({ operation: "operations/c", service: "ledger", env: "pr-42" }),
  ];
  const all = { query: "", service: "all", env: "all", state: "all" as const };
  const ops = (f: typeof all) => searchDeploys(rows, f).map((r) => r.operation);

  it("filters by service, environment and status", () => {
    expect(ops({ ...all, service: "ledger" })).toEqual(["operations/b", "operations/c"]);
    expect(ops({ ...all, env: "production" })).toEqual(["operations/a"]);
    expect(ops({ ...all, env: "preview" })).toEqual(["operations/c"]);
    expect(ops({ ...all, state: "failed" } as never)).toEqual(["operations/b"]);
  });

  it("searches the service, ref, who and why", () => {
    expect(ops({ ...all, query: "ci test" })).toEqual(["operations/b"]);
    expect(ops({ ...all, query: "PAYMENTS" })).toEqual(["operations/a"]);
  });
});
