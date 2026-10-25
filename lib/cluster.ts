import type { Capacity, Cluster, Volume } from "@/gen/forge/v1/cluster_pb";
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
// condition first, then the fullest of CPU, memory, disk or a volume from 80%
// used, else Healthy.
export function clusterStatus(cl: Cluster): Status {
  if (cl.unavailableReason) return { tone: "danger", word: "Unavailable" };
  for (const [condition, words] of conditionWords) {
    const n = cl.nodes.filter((node) => node.condition === condition).length;
    if (n === 0) continue;
    if (condition === "NotReady") return { tone: "danger", word: `${nodes(n)} not ready` };
    return { tone: "warning", word: `${words} on ${nodes(n)}` };
  }
  let worst = 0;
  let what = "";
  const consider = (p: number, w: string) => {
    if (p > worst) [worst, what] = [p, w];
  };
  const t = cl.totals;
  if (cl.metricsAvailable && t) {
    consider(pct(t.memoryUsedBytes, t.memoryBytes), "Memory");
    consider(pct(t.cpuUsedMillis, t.cpuMillis), "CPU");
  }
  if (cl.storageAvailable) {
    if (t) consider(pct(t.diskUsedBytes, t.diskBytes), "Disk");
    for (const v of cl.volumes) consider(pct(v.usedBytes, v.capacityBytes), `Volume ${v.namespace}/${v.claim}`);
  }
  if (level(worst) !== "ok") return { tone: tone[level(worst)], word: `${what} at ${worst}%` };
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

// usage is CPU, memory and disk of a node or the cluster; without metrics (or
// storage, for the disk) only the totals.
export function usage(c: Capacity | undefined, metrics: boolean, storage = false): { cpu: Meter; memory: Meter; disk: Meter } {
  const zero = BigInt(0);
  const cpuMillis = c?.cpuMillis ?? zero;
  const memoryBytes = c?.memoryBytes ?? zero;
  const cpuUsed = c?.cpuUsedMillis ?? zero;
  const memUsed = c?.memoryUsedBytes ?? zero;
  const diskBytes = c?.diskBytes ?? zero;
  const diskUsed = c?.diskUsedBytes ?? zero;
  return {
    cpu: metrics ? { pct: pct(cpuUsed, cpuMillis), used: cores(cpuUsed), total: cores(cpuMillis) } : { pct: null, used: "", total: cores(cpuMillis) },
    memory: metrics ? { pct: pct(memUsed, memoryBytes), used: gib(memUsed), total: gib(memoryBytes) } : { pct: null, used: "", total: gib(memoryBytes) },
    disk: storage && diskBytes > zero ? { pct: pct(diskUsed, diskBytes), used: gib(diskUsed), total: gib(diskBytes) } : { pct: null, used: "", total: "–" },
  };
}

// volumeMeter is how full a volume is.
export function volumeMeter(v: Volume): Meter {
  return { pct: pct(v.usedBytes, v.capacityBytes), used: gib(v.usedBytes), total: gib(v.capacityBytes) };
}
