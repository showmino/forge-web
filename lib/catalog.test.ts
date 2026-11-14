import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { ServiceSchema } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeploymentSchema } from "@/gen/forge/v1/deploy_pb";
import { catalogRows, filterRows, teamsOf, tierStatus } from "./catalog";

const NOW = new Date(2026, 10, 9, 15, 0, 0);
const ago = (minutes: number) => timestampFromDate(new Date(NOW.getTime() - minutes * 60_000));

const svc = (id: string, team = "billing", displayName = "", tier = 0) => create(ServiceSchema, { name: `services/${id}`, ownerTeam: team, displayName, tier });
const dep = (id: string, env: string, over: object = {}) =>
  create(DeploymentSchema, {
    name: `deployments/${id}/${env}`,
    service: `services/${id}`,
    env,
    commit: "abc1234",
    health: Deployment_Health.HEALTHY,
    sync: Deployment_SyncStatus.SYNCED,
    deployTime: ago(30),
    ...over,
  });

describe("the catalog's rows", () => {
  const services = [svc("ledger", "billing", "", 1), svc("payments", "billing", "", 1), svc("search", "discovery"), svc("idle", "growth"), svc("web", "commerce")];
  const deployments = [
    dep("ledger", "production"),
    dep("ledger", "staging"),
    dep("payments", "production", { health: Deployment_Health.DEGRADED, deployTime: ago(5) }),
    dep("payments", "staging"),
    dep("search", "staging", { sync: Deployment_SyncStatus.OUT_OF_SYNC }),
    dep("web", "production", { commit: "old0000" }),
    dep("web", "staging", { commit: "new1111" }),
  ];
  const rows = catalogRows(services, deployments, NOW);

  it("puts what is broken first and what runs nowhere last", () => {
    expect(rows.map((r) => r.id)).toEqual(["payments", "search", "ledger", "web", "idle"]);
  });

  it("shows the environment where it hurts, else production", () => {
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.payments.env).toBe("production");
    expect(by.payments.status.word).toBe("Degraded");
    expect(by.payments.when).toBe("5 min ago");
    expect(by.search.env).toBe("staging");
    expect(by.search.status.word).toBe("Out of sync");
    expect(by.ledger.env).toBe("production");
    expect(by.idle.env).toBe("");
    expect(by.idle.status.word).toBe("Not deployed");
  });

  it("knows when staging is ready to promote", () => {
    expect(rows.filter((r) => r.ahead).map((r) => r.id)).toEqual(["web"]);
  });

  it("filters by search, owner and status", () => {
    const all = { query: "", team: "all", status: "all" as const };
    expect(filterRows(rows, { ...all, query: "PAY" }).map((r) => r.id)).toEqual(["payments"]);
    expect(filterRows(rows, { ...all, team: "discovery" }).map((r) => r.id)).toEqual(["search"]);
    expect(filterRows(rows, { ...all, status: "attention" }).map((r) => r.id)).toEqual(["payments", "search"]);
    expect(filterRows(rows, { ...all, status: "healthy" }).map((r) => r.id)).toEqual(["ledger", "web"]);
    expect(filterRows(rows, { ...all, status: "ahead" }).map((r) => r.id)).toEqual(["web"]);
  });

  it("filters by tier, and names it", () => {
    const all = { query: "", team: "all", status: "all" as const };
    expect(filterRows(rows, { ...all, tier: "1" }).map((r) => r.id)).toEqual(["payments", "ledger"]);
    expect(filterRows(rows, { ...all, tier: "0" }).map((r) => r.id)).toEqual(["search", "web", "idle"]);
    expect(tierStatus(1)).toEqual({ tone: "danger", word: "Critical" });
    expect(tierStatus(0).word).toBe("Not set");
  });

  it("lists the owning teams once each", () => {
    expect(teamsOf(services)).toEqual(["billing", "commerce", "discovery", "growth"]);
  });
});
