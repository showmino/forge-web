import { type Approval, Approval_State } from "@/gen/forge/v1/approval_pb";
import type { GetStatusResponse } from "@/gen/forge/v1/auth_pb";
import { shortCommit, when } from "@/lib/format";
import type { Attention } from "@/lib/overview";

// Production runs of infrastructure repos that wait for the caller's team.
// Only the members of the team that owns the service are told: an admin,
// who may approve any run, hears only of their own teams' runs, as anyone
// else (the owner's choice; the Approvals page still lists every run).
// Whether the caller started a run, and so may not approve it themselves,
// the dashboard cannot tell: it does not know their GitHub user. Hence
// "your team's approval", not "yours".

// admin is in the type only to show it is ignored here.
type Caller = Pick<GetStatusResponse, "admin" | "teams">;

// waitingForTeam is the pending approvals the caller's team decides, oldest
// first: the one that waited longest leads.
export function waitingForTeam(approvals: Approval[], caller: Caller | undefined): Approval[] {
  if (!caller) return [];
  return approvals
    .filter((a) => a.state === Approval_State.PENDING && caller.teams.includes(a.ownerTeam))
    .sort((a, b) => Number(a.createTime?.seconds ?? 0) - Number(b.createTime?.seconds ?? 0));
}

// approvalAttention is one line of the Overview's "Needs attention" for each
// waiting run.
export function approvalAttention(waiting: Approval[], now = new Date()): Attention[] {
  return waiting.map((a) => {
    const service = a.service.replace(/^services\//, "");
    const asked = a.createTime ? `, ${when(a.createTime, now)}` : "";
    return {
      key: `approval-${a.name}`,
      tone: "warning",
      before: "Production of ",
      subject: service,
      after: " waits for your team's approval",
      detail: `${shortCommit(a.commit)}, started by ${a.requestedBy || "unknown"}${asked}`,
      href: "/approvals",
    };
  });
}
