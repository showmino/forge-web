import { describe, expect, it } from "vitest";
import { isChartRef, shortCommit, timeAgo, timeUntil } from "./format";

const now = new Date("2026-10-11T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("timeAgo", () => {
  it.each([
    ["2026-10-11T11:59:40Z", "just now"],
    ["2026-10-11T11:48:00Z", "12 min ago"],
    ["2026-10-11T10:00:00Z", "2 h ago"],
    ["2026-10-10T11:00:00Z", "yesterday"],
    ["2026-10-08T12:00:00Z", "3 days ago"],
    ["2026-08-01T12:00:00Z", "2026-08-01"],
    ["2026-10-11T12:40:00Z", "in 40 min"],
  ])("%s → %s", (then, want) => {
    expect(timeAgo(at(then), now)).toBe(want);
  });
});

describe("timeUntil", () => {
  it.each([
    ["2026-10-11T11:00:00Z", "now"],
    ["2026-10-11T12:00:30Z", "in under a minute"],
    ["2026-10-11T14:00:00Z", "in 2 h"],
    ["2026-10-12T19:00:00Z", "in 31 h"],
    ["2026-10-13T12:00:00Z", "in 2 days"],
    ["2026-10-14T12:00:00Z", "in 3 days"],
  ])("%s → %s", (then, want) => {
    expect(timeUntil(at(then), now)).toBe(want);
  });
});

describe("shortCommit", () => {
  it("shortens a commit and leaves anything else alone", () => {
    expect(shortCommit("18b12326d3df2c1a11b9f664f378b579eb472aaf")).toBe("18b1232");
    expect(shortCommit("main")).toBe("main");
    expect(shortCommit("")).toBe("");
  });

  it("shortens an image digest, which a service without a repo runs instead of a commit", () => {
    expect(shortCommit("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")).toBe("sha256:0123456789ab");
  });
});

describe("isChartRef", () => {
  it("tells a chart from an image", () => {
    expect(isChartRef("oci://ghcr.io/stefanprodan/charts/podinfo:6.7.1")).toBe(true);
    expect(isChartRef("https://charts.example.com/podinfo:1.0.0")).toBe(true);
    expect(isChartRef("docker.io/library/nginx@sha256:0123")).toBe(false);
    expect(isChartRef("ghcr.io/showmino/payments:1a2b3c4")).toBe(false);
  });
});
