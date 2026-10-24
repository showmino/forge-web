import type { Capacity, Cluster } from "@/gen/forge/v1/cluster_pb";
import type { Status } from "@/lib/status";

// How full a cluster is, as the Clusters pages and `forge cluster` say it.
// Thresholds of the design: amber from 80% used, red from 90%.

export type Level = "ok" | "warn" | "bad";

export function pct(used: bigint, total: bigint): number {
  if (total <= BigInt(0)) return 0;
  return Math.round((Number(used) * 100) / Number(total));
}

export function level(p: number): Level {
  return p >= 90 ? "bad" : p >= 80 ? "warn" : "ok";
}

const tone = { ok: "success", warn: "warning", bad: "danger" } as const;

// Node conditions in a status line, worst first.
const conditionWords: [condition: string, words: string][] = [
  ["NotReady", "not ready"],
  ["MemoryPressure", "Memory pressure"],
  ["DiskPressure", "Disk pressure"],
  ["PIDPressure", "PID pressure"],
  ["NetworkUnavailable", "Network unavailable"],
];

function nodes(n: number): string {
  return n === 1 ? "1 node" : `${n} nodes`;
}

// clusterStatus is the cluster's worst problem in a few words: a node
// condition first, then CPU or memory from 80% used, else Healthy.
export function clusterStatus(cl: Cluster): Status {
  for (const [condition, words] of conditionWords) {
    const n = cl.nodes.filter((node) => node.condition === condition).length;
    if (n === 0) continue;
    if (condition === "NotReady") return { tone: "danger", word: `${nodes(n)} not ready` };
    return { tone: "warning", word: `${words} on ${nodes(n)}` };
  }
  if (cl.metricsAvailable && cl.totals) {
    const cpu = pct(cl.totals.cpuUsedMillis, cl.totals.cpuMillis);
    const mem = pct(cl.totals.memoryUsedBytes, cl.totals.memoryBytes);
    const [what, p] = mem >= cpu ? ["Memory", mem] : ["CPU", cpu];
    if (level(p) !== "ok") return { tone: tone[level(p)], word: `${what} at ${p}%` };
  }
  return { tone: "success", word: "Healthy" };
}

export function cores(millis: bigint): string {
  const n = Number(millis);
  if (n % 1000 === 0) return n === 1000 ? "1 core" : `${n / 1000} cores`;
  return `${(n / 1000).toFixed(1)} cores`;
}

export function gib(bytes: bigint): string {
  return `${(Number(bytes) / 2 ** 30).toFixed(1)} GiB`;
}

export type Meter = { pct: number | null; used: string; total: string };

// usage is CPU and memory of a node or the cluster; without metrics only the totals.
export function usage(c: Capacity | undefined, metrics: boolean): { cpu: Meter; memory: Meter } {
  const zero = BigInt(0);
  const cpuMillis = c?.cpuMillis ?? zero;
  const memoryBytes = c?.memoryBytes ?? zero;
  const cpuUsed = c?.cpuUsedMillis ?? zero;
  const memUsed = c?.memoryUsedBytes ?? zero;
  return {
    cpu: metrics ? { pct: pct(cpuUsed, cpuMillis), used: cores(cpuUsed), total: cores(cpuMillis) } : { pct: null, used: "", total: cores(cpuMillis) },
    memory: metrics ? { pct: pct(memUsed, memoryBytes), used: gib(memUsed), total: gib(memoryBytes) } : { pct: null, used: "", total: gib(memoryBytes) },
  };
}
