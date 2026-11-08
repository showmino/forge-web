import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalService } from "@/gen/forge/v1/approval_pb";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { authAs, renderWithApi, signIn } from "@/test/helpers";
import ServicePage from "./(app)/services/[name]/page";

// A repo with an app and its infrastructure code (an infrastructure repo
// whose forge.yaml has run, infrastructure.runs): its page shows the app's
// deploys and previews as a service's, and the infrastructure and its
// approvals as an infrastructure repo's. Against an in-memory Forge API with
// the live API's names and shapes.

const nav = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const service = (runs: boolean) => ({
  name: "services/shop",
  displayName: "shop",
  ownerTeam: "web",
  lifecycle: Lifecycle.EXPERIMENTAL,
  repoUrl: "https://github.com/my-org/shop",
  infrastructure: { tool: "opentofu", target: "azure-main", environments: ["staging", "production"], runs },
});

function forge(runs: boolean) {
  const auth = authAs({ teams: ["web"] }, () => "web");
  return (router: ConnectRouter) => {
    router.service(AuthService, auth);
    router.service(ServiceCatalogService, {
      getService: () => ({ service: service(runs) }),
      listServices: () => ({ services: [service(runs)] }),
    });
    router.service(DeployService, { listDeployments: () => ({ deployments: [] }) });
    router.service(EnvironmentService, { listEnvironments: () => ({ environments: [] }) });
    router.service(OperationService, { listOperations: () => ({ operations: [] }) });
    router.service(AuditService, { listAuditEvents: () => ({ events: [] }) });
    router.service(ApprovalService, {
      listApprovals: () => ({ approvals: [] }),
      listExceptions: () => ({ exceptions: [] }),
    });
  };
}

async function open(runs: boolean) {
  nav.params = { name: "shop" };
  renderWithApi(<ServicePage />, forge(runs));
  await screen.findByRole("heading", { name: "shop" });
  await screen.findByRole("heading", { name: "Infrastructure" });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

describe("an infrastructure repo with an app", () => {
  it("shows the app's deploys and previews next to the infrastructure", async () => {
    await open(true);
    const tabs = within(screen.getByRole("tablist"));
    expect(tabs.getByRole("tab", { name: "Deployments" })).toBeTruthy();
    expect(tabs.getByRole("tab", { name: "Approvals" })).toBeTruthy();
    // The overview has the app's parts and the infrastructure's.
    expect(screen.getByRole("heading", { name: "Previews" })).toBeTruthy();
    expect(screen.getByText(/Forge deploys its app like any service's/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Preview env/ })).toBeTruthy();
    // Approvals are a tab of their own.
    fireEvent.click(tabs.getByRole("tab", { name: "Approvals" }));
    expect(await screen.findByText("No production run has asked for an approval yet.")).toBeTruthy();
  });

  it("stays an infrastructure repo without one", async () => {
    await open(false);
    const tabs = within(screen.getByRole("tablist"));
    expect(tabs.getByRole("tab", { name: "Approvals" })).toBeTruthy();
    expect(tabs.queryByRole("tab", { name: "Deployments" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Previews" })).toBeNull();
    expect(screen.getByText(/Forge never deploys it itself/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Preview env/ })).toBeNull();
  });
});
