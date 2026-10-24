import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { CapacitySchema, ClusterSchema, NodeSchema, VolumeSchema } from "@/gen/forge/v1/cluster_pb";
import { clusterStatus, cores, gib, level, pct, usage, volumeMeter } from "./cluster";

const GiB = BigInt(1) << BigInt(30);
const cap = (cpu: number, cpuUsed: number, memGiB: number, memUsedGiB: number) =>
  create(CapacitySchema, {
    cpuMillis: BigInt(cpu),
    cpuUsedMillis: BigInt(cpuUsed),
    memoryBytes: BigInt(memGiB) * GiB,
    memoryUsedBytes: BigInt(memUsedGiB) * GiB,
  });
const node = (condition: string) => create(NodeSchema, { condition });

describe("pct and level", () => {
  it.each([
    [0, 0, 0],
    [1, 3, 33],
    [2, 3, 67],
    [5, 4, 125],
  ])("%d of %d is %d%%", (used, total, want) => {
    expect(pct(BigInt(used), BigInt(total))).toBe(want);
  });

  it.each([
    [79, "ok"],
    [80, "warn"],
    [89, "warn"],
    [90, "bad"],
  ])("%d%% is %s", (p, want) => {
    expect(level(p)).toBe(want);
  });
});

describe("clusterStatus", () => {
  it.each([
    ["healthy", create(ClusterSchema, { metricsAvailable: true, totals: cap(1000, 100, 10, 1), nodes: [node("Ready")] }), "success", "Healthy"],
    ["memory high", create(ClusterSchema, { metricsAvailable: true, totals: cap(1000, 100, 100, 84) }), "warning", "Memory at 84%"],
    ["CPU very high", create(ClusterSchema, { metricsAvailable: true, totals: cap(1000, 910, 100, 84) }), "danger", "CPU at 91%"],
    ["no metrics", create(ClusterSchema, { metricsAvailable: false, totals: cap(1000, 910, 100, 84) }), "success", "Healthy"],
    ["two nodes under disk pressure", create(ClusterSchema, { nodes: [node("DiskPressure"), node("DiskPressure")] }), "warning", "Disk pressure on 2 nodes"],
    ["a node down beats pressure", create(ClusterSchema, { nodes: [node("MemoryPressure"), node("NotReady")] }), "danger", "1 node not ready"],
    ["disk high", create(ClusterSchema, { storageAvailable: true, totals: create(CapacitySchema, { diskBytes: BigInt(100), diskUsedBytes: BigInt(85) }) }), "warning", "Disk at 85%"],
    [
      "a volume fuller than memory",
      create(ClusterSchema, {
        metricsAvailable: true,
        storageAvailable: true,
        totals: cap(1000, 100, 100, 84),
        volumes: [create(VolumeSchema, { namespace: "payments-production", claim: "data", capacityBytes: BigInt(10), usedBytes: BigInt(9) })],
      }),
      "danger",
      "Volume payments-production/data at 90%",
    ],
    ["volumes without storage do not count", create(ClusterSchema, { volumes: [create(VolumeSchema, { capacityBytes: BigInt(10), usedBytes: BigInt(9) })] }), "success", "Healthy"],
  ] as const)("%s", (_, cl, tone, word) => {
    expect(clusterStatus(cl)).toEqual({ tone, word });
  });
});

describe("usage", () => {
  it("says what is in use of how much, or only how much without metrics", () => {
    const c = cap(4000, 1000, 8, 6);
    c.diskBytes = BigInt(200) * GiB;
    c.diskUsedBytes = BigInt(20) * GiB;
    expect(usage(c, true, true)).toEqual({
      cpu: { pct: 25, used: "1 core", total: "4 cores" },
      memory: { pct: 75, used: "6.0 GiB", total: "8.0 GiB" },
      disk: { pct: 10, used: "20.0 GiB", total: "200.0 GiB" },
    });
    expect(usage(c, false)).toEqual({
      cpu: { pct: null, used: "", total: "4 cores" },
      memory: { pct: null, used: "", total: "8.0 GiB" },
      disk: { pct: null, used: "", total: "–" },
    });
    expect(volumeMeter(create(VolumeSchema, { capacityBytes: BigInt(10) * GiB, usedBytes: BigInt(9) * GiB }))).toEqual({ pct: 90, used: "9.0 GiB", total: "10.0 GiB" });
  });

  it("writes cores and memory as the CLI does", () => {
    expect(cores(BigInt(3500))).toBe("3.5 cores");
    expect(cores(BigInt(1000))).toBe("1 core");
    expect(gib(BigInt(16) * GiB)).toBe("16.0 GiB");
  });
});
