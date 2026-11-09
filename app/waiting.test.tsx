import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { type ApprovalSchema, Approval_State, ApprovalService } from "@/gen/forge/v1/approval_pb";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { ClusterService } from "@/gen/forge/v1/cluster_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { ADMIN, authAs, READER, renderWithApi, signIn, type Caller } from "@/test/helpers";
import Overview from "./(app)/page";

// Production runs that wait for the caller's team: a line each in the
// Overview's "Needs attention", and a count on Approvals in the rail, against
// an in-memory Forge API with the live API's shapes.

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const ago = (m: number) => timestampFromDate(new Date(Date.now() - m * 60_000));
type Approval = MessageInitShape<typeof ApprovalSchema>;
const pending = (name: string, service: string, ownerTeam: string, minutes: number): Approval => ({
  name: `approvals/${name}`,
  service: `services/${service}`,
  environment: "production",
  commit: "18b12326d3df2c1a11b9f664f378b579eb472aaf",
  runUrl: "https://github.com/my-org/infra-network/actions/runs/1",
  requestedBy: "bo",
  state: Approval_State.PENDING,
  ownerTeam,
  createTime: ago(minutes),
});
const network = pending("apr_1", "infra-network", "network", 5);
const dns = pending("apr_2", "infra-dns", "network", 90);
const billing = pending("apr_3", "infra-billing", "payments", 10);

type World = { caller: Caller; approvals: Approval[]; noInfrastructure?: boolean; asked: number };

function forge(w: World) {
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller));
    router.service(ServiceCatalogService, { listServices: () => ({ services: [] }) });
    router.service(DeployService, { listDeployments: () => ({ deployments: [] }) });
    router.service(EnvironmentService, { listEnvironments: () => ({ environments: [] }) });
    router.service(OperationService, { listOperations: () => ({ operations: [] }) });
    router.service(ClusterService, { listClusters: () => ({ clusters: [] }) });
    router.service(AuditService, { listAuditEvents: () => ({ events: [] }) });
    router.service(ApprovalService, {
      listApprovals: (req) => {
        w.asked++;
        // A Forge without infrastructure repos has no approvals to list.
        if (w.noInfrastructure) throw new ConnectError("this Forge has no infrastructure targets", Code.FailedPrecondition);
        return { approvals: w.approvals.filter((a) => !req.state || a.state === req.state) };
      },
    });
  };
}

const world = (over: Partial<World> = {}): World => ({ caller: { teams: ["network"] }, approvals: [network, dns, billing], asked: 0, ...over });

async function openOverview(w: World) {
  renderWithApi(<Overview />, forge(w));
  await screen.findByRole("heading", { name: "Internal Developer Platform" });
  await waitFor(() => expect(w.asked).toBeGreaterThan(0));
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

describe("the Overview", () => {
  it("lists each run that waits for the caller's team first, the longest waiting on top", async () => {
    await openOverview(world());
    const list = await screen.findByRole("list", { name: "Needs attention" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Production of infra-dns waits for your team's approval");
    expect(rows[0].textContent).toContain("18b1232, started by bo, 1 h ago");
    expect(rows[1].textContent).toContain("infra-network");
    // Another team's run is not this caller's to approve.
    expect(list.textContent).not.toContain("infra-billing");
    expect(within(rows[0]).getByRole("link", { name: "Open infra-dns" }).getAttribute("href")).toBe("/approvals");
  });

  it("shows an admin only their own teams' runs, not every team's", async () => {
    await openOverview(world({ caller: { ...ADMIN, teams: ["payments"] } }));
    const rows = within(await screen.findByRole("list", { name: "Needs attention" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("infra-billing");
  });

  it("shows an admin in no team none", async () => {
    await openOverview(world({ caller: ADMIN }));
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeTruthy();
  });

  it("shows a reader none, and says nothing needs them", async () => {
    await openOverview(world({ caller: READER }));
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeTruthy();
  });

  it("stays quiet on a Forge without infrastructure repos", async () => {
    await openOverview(world({ noInfrastructure: true }));
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the rail", () => {
  it("counts the runs that wait for the caller's team beside Approvals", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge(world()));
    // The shell reads the session, then who is calling, then the approvals.
    expect(await screen.findByRole("link", { name: "Approvals 2 waiting for your team" })).toBeTruthy();
  });

  it("shows no count when nothing waits for the caller", async () => {
    const w = world({ caller: READER });
    renderWithApi(<AppShell>content</AppShell>, forge(w));
    await screen.findByText("content");
    await waitFor(() => expect(w.asked).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByRole("link", { name: "Approvals" })).toBeTruthy();
  });
});
