import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import type { Operation } from "@/gen/forge/v1/operation_pb";
import { deployKind, pipelineOf, type RecentDeploy, shipping } from "@/lib/overview";

// The Deployments page lists the deploys, promotions and rollbacks that are
// running (from the operations) and the ones that ended (from the audit log,
// which outlives a restart of the API).

export type DeployRow = RecentDeploy & { running: boolean };
export type DeployFilter = "all" | "running" | "failed" | "succeeded";

export function deployRows(running: Operation[], recent: RecentDeploy[]): DeployRow[] {
  const rows: DeployRow[] = [];
  const live = new Set<string>();
  for (const op of running) {
    const kind = deployKind(op.kind);
    const where = /^deployments\/([^/]+)\/([^/]+)$/.exec(op.target);
    if (!kind || !where || op.done) continue;
    live.add(op.name);
    rows.push({
      key: op.name,
      kind,
      service: where[1],
      env: where[2],
      pipeline: pipelineOf(op),
      time: op.createTime ? timestampDate(op.createTime) : undefined,
      note: "",
      operation: op.name,
      by: op.creator || "–",
      ref: shipping(op.events),
      running: true,
    });
  }
  for (const r of recent) if (!live.has(r.operation)) rows.push({ ...r, running: false });
  return rows;
}

export function matchesDeploy(row: DeployRow, f: DeployFilter): boolean {
  if (f === "all") return true;
  if (f === "running") return row.pipeline.state === "running";
  return row.pipeline.state === f;
}

// durations is how long each operation that ended took, from its request in
// the audit log to its outcome, by operation name.
export function durations(events: AuditEvent[]): Map<string, number> {
  const asked = new Map<string, number>();
  const took = new Map<string, number>();
  for (const e of events) {
    if (!e.operation || !e.time) continue;
    const at = timestampDate(e.time).getTime();
    if (e.kind === "request") asked.set(e.operation, at);
  }
  for (const e of events) {
    if (!e.operation || !e.time || e.kind !== "outcome") continue;
    const start = asked.get(e.operation);
    if (start !== undefined) took.set(e.operation, timestampDate(e.time).getTime() - start);
  }
  return took;
}

// median is the middle of the durations of the deploys that succeeded; null for none.
export function median(rows: DeployRow[], took: Map<string, number>): number | null {
  const ms = rows
    .filter((r) => r.pipeline.state === "succeeded")
    .map((r) => took.get(r.operation))
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  return ms.length ? ms[Math.floor(ms.length / 2)] : null;
}

// durationText says a duration the way a person would: "45 s", "6 min".
export function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export type DeploySearch = { query: string; service: string; env: string; state: DeployFilter };

// searchDeploys keeps the rows that match the search (service, ref, environment,
// who, why it failed) and the service, environment and status filters.
export function searchDeploys(rows: DeployRow[], f: DeploySearch): DeployRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchesDeploy(r, f.state)) return false;
    if (f.service !== "all" && r.service !== f.service) return false;
    if (f.env === "preview" ? r.env === "staging" || r.env === "production" : f.env !== "all" && r.env !== f.env) return false;
    return !q || `${r.service} ${r.ref} ${r.env} ${r.by} ${r.note}`.toLowerCase().includes(q);
  });
}
