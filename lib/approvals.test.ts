import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { Approval_State, ApprovalSchema } from "@/gen/forge/v1/approval_pb";
import { approvalAttention, waitingForTeam } from "./approvals";

const now = new Date("2026-11-08T12:00:00Z");
const ago = (m: number) => timestampFromDate(new Date(now.getTime() - m * 60_000));
const approval = (over: Record<string, unknown>) =>
  create(ApprovalSchema, {
    name: "approvals/apr_1",
    service: "services/infra-network",
    environment: "production",
    commit: "18b12326d3df2c1a11b9f664f378b579eb472aaf",
    requestedBy: "ana",
    state: Approval_State.PENDING,
    ownerTeam: "network",
    createTime: ago(5),
    ...over,
  });

describe("waitingForTeam", () => {
  const all = [
    approval({ name: "approvals/new", createTime: ago(5) }),
    approval({ name: "approvals/old", createTime: ago(90) }),
    approval({ name: "approvals/other-team", ownerTeam: "payments" }),
    approval({ name: "approvals/done", state: Approval_State.APPROVED }),
  ];

  it("keeps the pending runs of the caller's teams, the longest waiting first", () => {
    expect(waitingForTeam(all, { admin: false, teams: ["network"] }).map((a) => a.name)).toEqual(["approvals/old", "approvals/new"]);
  });

  it("gives an admin every pending run", () => {
    expect(waitingForTeam(all, { admin: true, teams: [] })).toHaveLength(3);
  });

  it("gives a reader, or a caller not known yet, none", () => {
    expect(waitingForTeam(all, { admin: false, teams: [] })).toEqual([]);
    expect(waitingForTeam(all, undefined)).toEqual([]);
  });
});

describe("approvalAttention", () => {
  it("is one line per run, naming the commit and who started it", () => {
    expect(approvalAttention([approval({})], now)).toEqual([
      {
        key: "approval-approvals/apr_1",
        tone: "warning",
        before: "Production of ",
        subject: "infra-network",
        after: " waits for your team's approval",
        detail: "18b1232, started by ana, 5 min ago",
        href: "/approvals",
      },
    ]);
  });
});
