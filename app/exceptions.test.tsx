import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalService } from "@/gen/forge/v1/approval_pb";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { authAs, READER, renderWithApi, signIn, type Caller } from "@/test/helpers";
import Approvals from "./(app)/approvals/page";
import ServicePage from "./(app)/services/[name]/page";

// Asking for an exception, and revoking one, from the dashboard: on the
// infrastructure repo's page and on the Approvals page, against an in-memory
// Forge API with the live API's names and shapes.

const nav = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const PR = "https://github.com/my-org/deploy/pull/7";
const network = {
  name: "services/infra-network",
  displayName: "infra-network",
  ownerTeam: "network",
  lifecycle: Lifecycle.PRODUCTION,
  repoUrl: "https://github.com/my-org/infra-network",
  infrastructure: { tool: "bicep", target: "azure-main", environments: ["staging", "production"] },
};
const granted = {
  service: "services/infra-network",
  team: "network",
  reason: "I am the only one on the team",
  requestedBy: "ana",
  requestTime: timestampFromDate(new Date()),
  granted: true,
  grantedBy: "bo",
  pullRequestUrl: "https://github.com/my-org/deploy/pull/3",
};

type World = { caller: Caller; exception: boolean; calls: Record<string, unknown[]>; fail?: ConnectError };

function world(over: Partial<World> = {}): World {
  return { caller: { teams: ["network"] }, exception: false, calls: {}, ...over };
}

function forge(w: World) {
  const record = (k: string, req: unknown) => (w.calls[k] ??= []).push(req);
  const auth = authAs(w.caller, () => "network");
  return (router: ConnectRouter) => {
    router.service(AuthService, {
      getStatus: auth.getStatus,
      // The live API answers approval.exception only when asked for it by
      // name; its role is the service's team (rbac.go).
      testPermissions: (req) => {
        record("testPermissions", req);
        if (req.actions.includes("approval.exception")) {
          const allowed = !!w.caller.admin || (w.caller.teams ?? []).includes("network");
          return { allowed: allowed ? ["approval.exception"] : [], role: allowed ? "team" : "reader" };
        }
        return auth.testPermissions(req);
      },
    });
    router.service(ServiceCatalogService, {
      getService: () => ({ service: network }),
      listServices: () => ({ services: [network] }),
    });
    router.service(DeployService, { listDeployments: () => ({ deployments: [] }) });
    router.service(EnvironmentService, { listEnvironments: () => ({ environments: [] }) });
    router.service(OperationService, { listOperations: () => ({ operations: [] }) });
    router.service(AuditService, { listAuditEvents: () => ({ events: [] }) });
    router.service(ApprovalService, {
      listApprovals: () => ({ approvals: [] }),
      listExceptions: () => ({ exceptions: w.exception ? [granted] : [] }),
      requestException: (req) => {
        record("requestException", req);
        if (w.fail) throw w.fail;
        return { pullRequestUrl: PR };
      },
      revokeException: (req) => {
        record("revokeException", req);
        return { pullRequestUrl: PR };
      },
    });
  };
}

async function openService(w: World) {
  nav.params = { name: "infra-network" };
  renderWithApi(<ServicePage />, forge(w));
  await screen.findByRole("heading", { name: "infra-network" });
  await screen.findByText(/^None: who starts a production run may not approve it$|^The team approves its own runs/);
}

const asked = (w: World) => waitFor(() => expect((w.calls.testPermissions ?? []).some((r) => (r as { actions: string[] }).actions.includes("approval.exception"))).toBe(true));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

describe("an exception on the repo's page", () => {
  it("lets the team ask for one, with a reason, and links the pull request", async () => {
    const w = world();
    await openService(w);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for an exception" }));
    const dialog = screen.getByRole("dialog", { name: "Ask for an exception for infra-network" });
    const submit = within(dialog).getByRole("button", { name: "Ask for exception" }) as HTMLButtonElement;
    // The platform team needs a reason: without one there is nothing to send.
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "  I am the only one on the team " } });
    fireEvent.click(submit);
    const done = await screen.findByRole("dialog", { name: "Pull request opened" });
    expect(w.calls.requestException).toEqual([expect.objectContaining({ service: "services/infra-network", reason: "I am the only one on the team" })]);
    expect(within(done).getByRole("link", { name: "Open the pull request" }).getAttribute("href")).toBe(PR);
    expect(screen.getByText("forge approval exception request infra-network")).toBeTruthy();
  });

  it("keeps the dialog open with the API's reason when it refuses", async () => {
    const w = world({ fail: new ConnectError("services/infra-network has an exception already", Code.AlreadyExists) });
    await openService(w);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for an exception" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "alone" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for exception" }));
    expect((await screen.findByRole("alert")).textContent).toContain("has an exception already");
    expect(screen.getByRole("dialog", { name: "Ask for an exception for infra-network" })).toBeTruthy();
  });

  it("lets the team revoke the one it has", async () => {
    const w = world({ exception: true });
    await openService(w);
    expect(screen.getByRole("link", { name: "github.com/my-org/deploy/pull/3" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke exception" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke the exception of infra-network" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Bo joined the team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke exception" }));
    await screen.findByRole("dialog", { name: "Pull request opened" });
    expect(w.calls.revokeException).toEqual([expect.objectContaining({ service: "services/infra-network", reason: "Bo joined the team" })]);
    expect(w.calls.requestException).toBeUndefined();
  });

  it("offers nothing to a reader", async () => {
    const w = world({ caller: READER });
    await openService(w);
    await asked(w);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Ask for an exception" })).toBeNull();
  });
});

describe("exceptions on the Approvals page", () => {
  it("lets the team revoke its exception", async () => {
    const w = world({ exception: true });
    renderWithApi(<Approvals />, forge(w));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke the exception of infra-network" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke exception" }));
    await screen.findByRole("dialog", { name: "Pull request opened" });
    expect(w.calls.revokeException).toEqual([expect.objectContaining({ service: "services/infra-network", reason: "" })]);
  });

  it("shows a reader no Revoke", async () => {
    const w = world({ caller: READER, exception: true });
    renderWithApi(<Approvals />, forge(w));
    await screen.findByRole("table", { name: "Exceptions" });
    await asked(w);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Revoke the exception of infra-network" })).toBeNull();
  });
});
