import { timestampDate } from "@bufbuild/protobuf/wkt";
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
