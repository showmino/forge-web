import { Lifecycle } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, type Deployment } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, type Environment } from "@/gen/forge/v1/environment_pb";
import type { Operation } from "@/gen/forge/v1/operation_pb";

// A status is a glyph, a word and a colour together (the design system's
// StatusBadge). These functions pick the tone and the word from what the API says.

export type Tone = "success" | "progress" | "warning" | "danger" | "neutral";
export type Status = { tone: Tone; word: string };

export const NOT_DEPLOYED: Status = { tone: "neutral", word: "Not deployed" };

// deploymentStatus says how staging or production of a service is doing.
export function deploymentStatus(d: Deployment | undefined): Status {
  if (!d) return NOT_DEPLOYED;
  switch (d.health) {
    case Deployment_Health.HEALTHY:
      return d.sync === Deployment_SyncStatus.OUT_OF_SYNC
        ? { tone: "warning", word: "Out of sync" }
        : { tone: "success", word: "Healthy" };
    case Deployment_Health.PROGRESSING:
      return { tone: "progress", word: "Syncing" };
    case Deployment_Health.DEGRADED:
      return { tone: "warning", word: "Degraded" };
    case Deployment_Health.MISSING:
      return NOT_DEPLOYED;
    case Deployment_Health.SUSPENDED:
      return { tone: "neutral", word: "Suspended" };
    default:
      return { tone: "neutral", word: "Unknown" };
  }
}

// environmentStatus says how a preview is doing.
export function environmentStatus(e: Environment): Status {
  switch (e.state) {
    case Environment_State.CREATING:
      return { tone: "progress", word: "Creating" };
    case Environment_State.READY:
      return { tone: "success", word: "Ready" };
    case Environment_State.FAILED:
      return { tone: "danger", word: "Failed" };
    case Environment_State.DESTROYING:
      return { tone: "progress", word: "Destroying" };
    default:
      return { tone: "neutral", word: "Unknown" };
  }
}

// auditStatus turns an audit result code ("ok", "failed", "permission_denied", ...) into a status.
export function auditStatus(code: string | undefined): Status {
  if (!code || code === "ok") return { tone: "success", word: "OK" };
  if (code === "permission_denied" || code === "unauthenticated") return { tone: "danger", word: "Denied" };
  if (code === "canceled" || code === "cancelled") return { tone: "neutral", word: "Cancelled" };
  return { tone: "danger", word: "Failed" };
}

export function lifecycleWord(l: Lifecycle): string {
  switch (l) {
    case Lifecycle.EXPERIMENTAL:
      return "Experimental";
    case Lifecycle.PRODUCTION:
      return "Production";
    case Lifecycle.DEPRECATED:
      return "Deprecated";
    default:
      return "Not set";
  }
}

// operationStatus says how a long-running operation is doing or how it ended.
export function operationStatus(op: Operation | undefined): Status {
  if (!op || !op.done) return { tone: "progress", word: "Running" };
  if (!op.error) return { tone: "success", word: "Succeeded" };
  if (op.error.code === "cancelled") return { tone: "neutral", word: "Cancelled" };
  return { tone: "danger", word: "Failed" };
}

const kinds: Record<string, string> = {
  deploy: "Deploy",
  promote: "Promote",
  rollback: "Roll back",
  create_environment: "Create preview",
  destroy_environment: "Destroy preview",
  delete_service: "Delete",
};

// operationTitle names an operation by what it does and to what: "Promote forge-web to production".
export function operationTitle(op: Operation): string {
  const kind = kinds[op.kind] ?? (op.kind ? op.kind.charAt(0).toUpperCase() + op.kind.slice(1).replace(/[_.]/g, " ") : "Operation");
  const deployment = /^deployments\/([^/]+)\/([^/]+)$/.exec(op.target);
  if (deployment) return `${kind} ${deployment[1]} ${op.kind === "rollback" ? "in" : "to"} ${deployment[2]}`;
  const preview = /^environments\/(.+)$/.exec(op.target);
  if (preview) return `${kind} ${preview[1]}`;
  const service = /^services\/(.+)$/.exec(op.target);
  if (service) return `${kind} ${service[1]}`;
  return op.target ? `${kind} ${op.target}` : kind;
}
