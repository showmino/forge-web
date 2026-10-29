import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import { type Deployment, Deployment_Health, Deployment_SyncStatus } from "@/gen/forge/v1/deploy_pb";
import { type Environment, Environment_State } from "@/gen/forge/v1/environment_pb";
import type { Operation, OperationEvent } from "@/gen/forge/v1/operation_pb";
import { environmentId, serviceId } from "@/lib/api";
import { actorText, shortCommit, timeAgo, timeUntil } from "@/lib/format";

// The overview answers three questions from what the API already knows: what
// is shipping (running operations), what is broken or about to be (the state
// of deployments and previews, the last result of each deploy target), and
// how the day went (the audit log, which outlives a restart of the API).

// A deploy moves through these, in order. Building and testing happen in the
// service's CI before Forge is asked, so the line starts at the image.
export const STAGES = ["Image", "Release", "Commit", "Namespace", "Sync"] as const;

export type DeployKind = "deploy" | "promote" | "rollback";
export type PipelineState = "running" | "succeeded" | "failed" | "cancelled";
// Where a deploy is, or where it stopped.
export type Pipeline = { stage: number; state: PipelineState };
export type Segment = "done" | "active" | "fail" | "";

export function deployKind(kind: string): DeployKind | null {
  return kind === "deploy" || kind === "promote" || kind === "rollback" ? kind : null;
}

// The stage a step's event completes. "resolve" and "address" come before the
// first stage; "sync" events are progress within the last.
const COMPLETES: Record<string, number> = { image: 0, release: 1, commit: 2, namespace: 3 };
// A promotion has its image already, and a rollback its version too.
const STARTS_AFTER: Record<DeployKind, number> = { deploy: -1, promote: 0, rollback: 1 };

// stageOf is the stage the work is at: the one after the last completed.
export function stageOf(kind: DeployKind, events: Pick<OperationEvent, "step">[]): number {
  let done = STARTS_AFTER[kind];
  for (const e of events) {
    if (e.step === "sync") return STAGES.length - 1;
    const stage = COMPLETES[e.step];
    if (stage !== undefined && stage > done) done = stage;
  }
  return Math.min(done + 1, STAGES.length - 1);
}

export function pipelineOf(op: Operation, events: Pick<OperationEvent, "step">[] = op.events): Pipeline {
  const kind = deployKind(op.kind) ?? "deploy";
  const stage = stageOf(kind, events);
  if (!op.done) return { stage, state: "running" };
  if (!op.error) return { stage: STAGES.length - 1, state: "succeeded" };
  return { stage, state: op.error.code === "cancelled" ? "cancelled" : "failed" };
}

export function segment(p: Pipeline, i: number): Segment {
  if (p.state === "succeeded") return "done";
  if (i < p.stage) return "done";
  if (i > p.stage) return "";
  return p.state === "running" ? "active" : p.state === "failed" ? "fail" : "";
}

const DEPLOY_ACTIONS: Record<string, DeployKind> = { "deploy.start": "deploy", "deploy.promote": "promote", "deploy.rollback": "rollback" };

// The stage a failed deploy stopped at, from the code its message starts with.
function failedStage(message: string): number {
  const code = message.split(":")[0];
  if (code === "ci_failed" || code.startsWith("image")) return 0;
  if (code === "release_failed") return 1;
  if (code.startsWith("namespace")) return 3;
  if (code.startsWith("sync") || code === "unhealthy") return 4;
  return STAGES.length - 1;
}

// A deploy that has ended, as the audit log records it.
export type RecentDeploy = {
  key: string;
  kind: DeployKind;
  service: string;
  env: string;
  pipeline: Pipeline;
  time: Date | undefined;
  // Why it failed, without the code.
  note: string;
  operation: string;
  // Who asked for it: a person's email, or the repository of a CI run.
  by: string;
  // The branch, tag or commit a deploy was asked for, or the deploy commit a
  // rollback went back to. A promotion names none: it takes what staging runs.
  ref: string;
};

function target(e: AuditEvent): { service: string; env: string } | null {
  const m = /^deployments\/([^/]+)\/([^/]+)$/.exec(e.target);
  return m ? { service: m[1], env: m[2] } : null;
}

// recentDeploys picks the deploys, promotions and rollbacks that ended, in the
// order the log gives them (newest first).
export function recentDeploys(events: AuditEvent[]): RecentDeploy[] {
  const out: RecentDeploy[] = [];
  for (const e of events) {
    const kind = DEPLOY_ACTIONS[e.action];
    const t = target(e);
    if (!kind || !t || e.kind !== "outcome") continue;
    const code = e.result?.code ?? "";
    const message = e.result?.message ?? "";
    const state: PipelineState = code === "ok" ? "succeeded" : code === "cancelled" ? "cancelled" : "failed";
    out.push({
      key: e.name,
      kind,
      ...t,
      pipeline: { stage: state === "succeeded" ? STAGES.length - 1 : failedStage(message), state },
      time: e.time ? timestampDate(e.time) : undefined,
      note: state === "failed" ? message.replace(/^[a-z_]+: /, "") : "",
      operation: e.operation,
      by: actorText(e),
      ref: e.details["ref"] || shortCommit(e.details["to"] ?? ""),
    });
  }
  return out;
}

export type DayStats = { started: number; finished: number; failed: number };

// dayStats counts the deploys of the day `now` is in: the ones that were
// started (a dry run or a refused request starts nothing), and of those that
// ended, how many failed.
export function dayStats(events: AuditEvent[], now = new Date()): DayStats {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stats: DayStats = { started: 0, finished: 0, failed: 0 };
  for (const e of events) {
    if (!DEPLOY_ACTIONS[e.action] || !e.time || timestampDate(e.time).getTime() < midnight) continue;
    const code = e.result?.code ?? "";
    if (e.kind === "outcome") {
      stats.finished++;
      if (code !== "ok" && code !== "cancelled") stats.failed++;
    } else if (code === "ok" && e.details["validate_only"] !== "true") {
      stats.started++;
    }
  }
  return stats;
}

// How urgently a deployment needs a look: the same classification attention()
// gives each deployment, collapsed to one grade instead of a list of reasons.
export type Severity = "bad" | "warn" | "ok" | "none";

export function severity(d: Deployment | undefined): Severity {
  if (!d || !d.commit) return "none"; // never deployed there
  if (d.health === Deployment_Health.DEGRADED || d.health === Deployment_Health.MISSING) return "bad";
  if (d.sync === Deployment_SyncStatus.OUT_OF_SYNC && d.health !== Deployment_Health.PROGRESSING) return "warn";
  return "ok";
}

// severityRank orders grades from most to least urgent: bad, then warn, then ok, then none.
export const SEVERITY_RANK: Record<Severity, number> = { bad: 0, warn: 1, ok: 2, none: 3 };
export function worse(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

// The status board: staging and production at a glance. One tile per service
// deployed there, what is broken first; a healthy tile names what runs.
export const BOARD_ENVS = ["production", "staging"] as const;

export type Tile = {
  service: string;
  severity: Exclude<Severity, "none">;
  // "Degraded", "Not running" or "Out of sync"; else the version or commit
  // that runs, or "Progressing" while Argo CD rolls it out.
  word: string;
  // When it was deployed: "31 min ago".
  when: string;
  href: string;
};

export type BoardRow = {
  env: (typeof BOARD_ENVS)[number];
  tiles: Tile[];
  unhealthy: number;
  outOfSync: number;
  // Services in the catalog with nothing in this environment; undefined
  // when the catalog is not known.
  notDeployed?: number;
};

function tileWord(d: Deployment, grade: Severity): string {
  if (d.health === Deployment_Health.DEGRADED) return "Degraded";
  if (d.health === Deployment_Health.MISSING) return "Not running";
  if (grade === "warn") return "Out of sync";
  if (d.health === Deployment_Health.PROGRESSING) return "Progressing";
  return d.version || shortCommit(d.commit);
}

// board groups the deployments by environment, worst first, then by name.
export function board(deployments: Deployment[], services: number | undefined, now = new Date()): BoardRow[] {
  return BOARD_ENVS.map((env) => {
    const tiles: Tile[] = [];
    for (const d of deployments) {
      const grade = severity(d);
      if (d.env !== env || grade === "none") continue;
      const service = serviceId(d.service);
      tiles.push({
        service,
        severity: grade,
        word: tileWord(d, grade),
        when: d.deployTime ? timeAgo(timestampDate(d.deployTime), now) : "",
        href: `/services/${service}`,
      });
    }
    tiles.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.service.localeCompare(b.service));
    return {
      env,
      tiles,
      unhealthy: tiles.filter((t) => t.severity === "bad").length,
      outOfSync: tiles.filter((t) => t.severity === "warn").length,
      notDeployed: services === undefined ? undefined : Math.max(0, services - tiles.length),
    };
  });
}

// Something a person should look at, most urgent first.
export type Attention = {
  key: string;
  tone: "danger" | "warning";
  // The subject is a name, set in the code face; the rest reads around it.
  before: string;
  subject: string;
  after: string;
  detail: string;
  href: string;
  // A preview that can be extended from here.
  extend?: Environment;
};

// How soon a preview's end is worth a line.
const EXPIRES_SOON_MS = 6 * 3600_000;
// endsSoon is the time a ready preview has left, when that is six hours or less.
function endsSoon(e: Environment, now: Date): Date | null {
  if (e.state !== Environment_State.READY || !e.expireTime) return null;
  const ends = timestampDate(e.expireTime);
  const left = ends.getTime() - now.getTime();
  return left > 0 && left <= EXPIRES_SOON_MS ? ends : null;
}

// expiringSoon counts the previews that end within six hours.
export function expiringSoon(environments: Environment[], now = new Date()): number {
  return environments.filter((e) => endsSoon(e, now)).length;
}

// How long a failed deploy stays on the page when nothing replaced it.
const FAILED_FOR_MS = 24 * 3600_000;

// attention lists what is broken or about to be: deployments Argo CD does not
// call healthy, deploy targets whose last deploy failed, and previews that
// failed or end soon.
export function attention(deployments: Deployment[], environments: Environment[], recent: RecentDeploy[], now = new Date()): Attention[] {
  const out: Attention[] = [];
  for (const d of deployments) {
    if (!d.commit) continue; // never deployed
    const service = serviceId(d.service);
    const item = { subject: service, before: "", href: `/services/${service}`, detail: d.message || `Argo CD reports this for ${service}-${d.env}.` };
    if (d.health === Deployment_Health.DEGRADED) {
      out.push({ ...item, key: `${d.name}/health`, tone: "danger", after: ` is degraded in ${d.env}` });
    } else if (d.health === Deployment_Health.MISSING) {
      out.push({ ...item, key: `${d.name}/health`, tone: "danger", after: ` is not running in ${d.env}` });
    } else if (d.sync === Deployment_SyncStatus.OUT_OF_SYNC && d.health !== Deployment_Health.PROGRESSING) {
      out.push({ ...item, key: `${d.name}/sync`, tone: "warning", after: ` is out of sync in ${d.env}`, detail: d.message || "What runs is not what the deploy repo says." });
    }
  }
  // The newest result per target decides: a later success clears a failure.
  const seen = new Set<string>();
  for (const r of recent) {
    const where = `${r.service}/${r.env}`;
    if (seen.has(where)) continue;
    seen.add(where);
    if (r.pipeline.state !== "failed" || !r.time || now.getTime() - r.time.getTime() > FAILED_FOR_MS) continue;
    const what = r.kind === "promote" ? "promotion to" : r.kind === "rollback" ? "rollback in" : "deploy to";
    out.push({
      key: r.key,
      tone: "danger",
      before: "The last ",
      subject: r.service,
      after: ` ${what} ${r.env} failed`,
      detail: r.note || "See the service page for what runs now.",
      href: `/services/${r.service}`,
    });
  }
  for (const e of environments) {
    const id = environmentId(e.name);
    const service = serviceId(e.service);
    const by = `${service} · created by ${e.creator || "unknown"}`;
    if (e.state === Environment_State.FAILED) {
      out.push({ key: `${e.name}/failed`, tone: "danger", before: "Preview ", subject: id, after: " failed", detail: by, href: `/services/${service}` });
    } else {
      const ends = endsSoon(e, now);
      if (ends) {
        out.push({ key: `${e.name}/expires`, tone: "warning", before: "Preview ", subject: id, after: ` expires ${timeUntil(ends, now)}`, detail: by, href: `/services/${service}`, extend: e });
      }
    }
  }
  return out.sort((a, b) => Number(b.tone === "danger") - Number(a.tone === "danger"));
}

// The version or commit an operation is shipping, read from its steps:
// "release candidate v0.1.2-rc.1 for 5235eea" or "main is 5235eea".
export function shipping(events: Pick<OperationEvent, "step" | "message">[]): string {
  let commit = "";
  for (const e of events) {
    if (e.step === "release") {
      const version = /\bv\d+\.\d+\.\d+(-rc\.\d+)?\b/.exec(e.message);
      if (version) return version[0];
    }
    if (e.step === "resolve") commit = / is ([0-9a-f]{7,40})$/.exec(e.message)?.[1] ?? commit;
  }
  return commit;
}
