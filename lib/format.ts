import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";

// actorText names who did it: a person by email, a CI run by its repository.
export function actorText(e: Pick<AuditEvent, "actor">): string {
  const a = e.actor;
  if (!a) return "–";
  return a.email || a.repository || a.subject || a.kind || "–";
}

// timeAgo says how long ago a moment was, in the words of the design system: "12 min ago", "2 h ago".
export function timeAgo(then: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 0) return timeUntil(then, now);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toISOString().slice(0, 10);
}

// timeUntil says how far off a moment is: "in 40 min", "in 2 h".
export function timeUntil(then: Date, now = new Date()): string {
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return "now";
  if (seconds < 60) return "in under a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  // Hours for the first two days: "in 31 h" says more than "in 1 day".
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.floor(hours / 24)} days`;
}

// when is timeAgo for an API timestamp, or a dash when there is none.
export function when(ts: Timestamp | undefined, now = new Date()): string {
  return ts ? timeAgo(timestampDate(ts), now) : "–";
}

// exact is the full time for a tooltip: 2026-10-11 14:02:15 UTC.
export function exact(ts: Timestamp | undefined): string | undefined {
  return ts ? timestampDate(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : undefined;
}

// shortCommit shortens a commit to the seven characters people read aloud.
export function shortCommit(commit: string): string {
  // A service without a repo runs an image digest; Forge shows 12 of its hex digits.
  const digest = /^sha256:([0-9a-f]{12})[0-9a-f]*$/.exec(commit);
  if (digest) return `sha256:${digest[1]}`;
  return /^[0-9a-f]{8,}$/.test(commit) ? commit.slice(0, 7) : commit;
}
