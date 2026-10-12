import { timestampDate } from "@bufbuild/protobuf/wkt";
import { type Deployment, Deployment_Health } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { serviceId } from "@/lib/api";
import { timeUntil } from "@/lib/format";
import { deploymentStatus, type Status } from "@/lib/status";

// The Environments page: how staging and production are doing across the
// catalog, and every preview with the time it has left.

export type EnvSummary = {
  // Services that run something here.
  deployed: number;
  healthy: number;
  // Services that run here and that Argo CD does not call healthy.
  needsLook: string[];
  status: Status;
};

const worse = ["success", "neutral", "progress", "warning", "danger"] as const;

export function envSummary(deployments: Deployment[], env: string): EnvSummary {
  const here = deployments.filter((d) => d.env === env && !!d.commit && d.health !== Deployment_Health.MISSING);
  const statuses = here.map((d) => ({ service: serviceId(d.service), status: deploymentStatus(d) }));
  const needsLook = statuses.filter((s) => s.status.tone !== "success").map((s) => s.service);
  let status: Status = here.length ? { tone: "success", word: "Healthy" } : { tone: "neutral", word: "Nothing deployed" };
  for (const s of statuses) if (worse.indexOf(s.status.tone) > worse.indexOf(status.tone)) status = s.status;
  return { deployed: here.length, healthy: here.length - needsLook.length, needsLook, status };
}

// When a preview's end is close enough to say so.
export const ENDS_SOON_MS = 6 * 3600_000;

export type PreviewLife = { share: number; words: string; soon: boolean };

// previewLife says how much of a preview's time is left, as a share of the
// whole (for the bar) and in words.
export function previewLife(e: Environment, now = new Date()): PreviewLife | null {
  if (!e.expireTime) return null;
  const ends = timestampDate(e.expireTime).getTime();
  const starts = e.createTime ? timestampDate(e.createTime).getTime() : ends;
  const left = Math.max(0, ends - now.getTime());
  const whole = ends - starts;
  const share = whole > 0 ? Math.min(1, left / whole) : left > 0 ? 1 : 0;
  return { share, words: left > 0 ? `ends ${timeUntil(new Date(ends), now)}` : "ending now", soon: left <= ENDS_SOON_MS };
}
