import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { type Resource, Resource_State, type ResourceChange, type ResourcePlan, ResourcePlan_State, type ResourceSettings } from "@/gen/forge/v1/resource_pb";
import type { Status } from "@/lib/status";

// What the Resources tab shows of a service's resources (its databases) and
// their plans. A plan is made from forge.yaml by the CLI or the service's CI;
// the dashboard reads plans and applies one that is ready.

// settingsText is one resource's settings in a few words: "postgres, 10 Gi, 2 instances".
export function settingsText(s: ResourceSettings | undefined): string {
  if (!s) return "–";
  const parts = [s.type];
  if (s.storageGi) parts.push(`${s.storageGi} Gi`);
  if (s.instances) parts.push(s.instances === 1 ? "1 instance" : `${s.instances} instances`);
  return parts.filter(Boolean).join(", ");
}

// CHANGE_SYMBOLS are the CLI's marks for a change ("forge resource plan").
export const CHANGE_SYMBOLS: Record<string, string> = { create: "+", update: "~", delete: "-", replace: "±" };

// changeText says what one change does: "create db (postgres, 10 Gi, 1 instance)".
export function changeText(c: ResourceChange): string {
  switch (c.action) {
    case "create":
      return `create ${c.resource} (${settingsText(c.after)})`;
    case "delete":
      return `delete ${c.resource} (${settingsText(c.before)})`;
    default:
      return `${c.action} ${c.resource}: ${settingsText(c.before)} → ${settingsText(c.after)}`;
  }
}

// changeSummary counts a plan's changes the way the CLI does: "+1 ~0 -1", or "No changes".
export function changeSummary(p: ResourcePlan): string {
  if (p.changes.length === 0) return "No changes";
  const n = (a: string) => p.changes.filter((c) => c.action === a).length;
  const parts = [`+${n("create")}`, `~${n("update")}`, `-${n("delete")}`];
  if (n("replace")) parts.push(`±${n("replace")}`);
  return parts.join(" ");
}

// destructive lists the resources a plan deletes or replaces: each loses its
// data, so the dialog asks for its name, as the CLI does.
export function destructive(p: ResourcePlan): string[] {
  return p.changes.filter((c) => c.action === "delete" || c.action === "replace").map((c) => c.resource);
}

const expired = (t: Timestamp | undefined, now: number) => !!t && timestampDate(t).getTime() <= now;

// applicable says whether a plan can still be applied: planned, allowed by
// policy and not expired. The API checks again (and whether forge.yaml or
// the resources changed since).
export function applicable(p: ResourcePlan, now = Date.now()): boolean {
  return p.state === ResourcePlan_State.PLANNED && !p.policy?.denied && !expired(p.expireTime, now);
}

// planStatus is a plan's state as a status pill.
export function planStatus(p: ResourcePlan, now = Date.now()): Status {
  switch (p.state) {
    case ResourcePlan_State.PLANNING:
      return { tone: "progress", word: "Planning" };
    case ResourcePlan_State.PLANNED:
      return expired(p.expireTime, now) ? { tone: "neutral", word: "Expired" } : { tone: "success", word: "Ready to apply" };
    case ResourcePlan_State.DENIED:
      return { tone: "danger", word: "Denied" };
    case ResourcePlan_State.FAILED:
      return { tone: "danger", word: "Plan failed" };
    case ResourcePlan_State.APPLYING:
      return { tone: "progress", word: "Applying" };
    case ResourcePlan_State.APPLIED:
      return { tone: "success", word: "Applied" };
    case ResourcePlan_State.APPLY_FAILED:
      return { tone: "danger", word: "Apply failed" };
    case ResourcePlan_State.EXPIRED:
      return { tone: "neutral", word: "Expired" };
    default:
      return { tone: "neutral", word: "Unknown" };
  }
}

// resourceStatus is how the last apply left a resource and, once ready,
// what the cluster reports now.
export function resourceStatus(r: Resource): Status {
  switch (r.state) {
    case Resource_State.APPLYING:
      return { tone: "progress", word: "Applying" };
    case Resource_State.FAILED:
      return { tone: "danger", word: "Failed" };
    case Resource_State.DELETING:
      return { tone: "progress", word: "Deleting" };
    case Resource_State.READY: {
      const h = r.health;
      if (!h || h.phase === "unknown") return { tone: "neutral", word: "Unknown" };
      if (h.instances > 0 && h.readyInstances < h.instances) return { tone: "warning", word: "Degraded" };
      return { tone: "success", word: "Healthy" };
    }
    default:
      return { tone: "neutral", word: "Unknown" };
  }
}

// healthText is the cluster's report in words: "2/2 ready, Cluster in healthy state".
export function healthText(r: Resource): string {
  const h = r.health;
  if (!h) return "–";
  const ready = h.instances ? `${h.readyInstances}/${h.instances} ready` : "";
  return [ready, h.phase && h.phase !== "unknown" ? h.phase : ""].filter(Boolean).join(", ") || "–";
}
