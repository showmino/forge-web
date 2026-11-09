import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalService } from "@/gen/forge/v1/approval_pb";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { serviceEnvs } from "@/lib/api";
import { authAs, renderWithApi, signIn } from "@/test/helpers";
import ServicePage from "./(app)/services/[name]/page";

// A service's environments (staging, production or both): its page shows
// only the ones it has, deploys to its one environment, offers no promote
// without both, takes an environment down, and changes them in Settings.
// Against an in-memory Forge API with the live API's names and shapes.

const nav = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const COMMIT = "18b1232aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tool = {
  name: "services/tool",
  displayName: "tool",
  ownerTeam: "web",
  lifecycle: Lifecycle.EXPERIMENTAL,
  repoUrl: "https://github.com/my-org/tool",
  etag: 'W/"3"',
  environments: ["production"],
};

type World = { calls: Record<string, unknown[]> };

function forge(w: World) {
  const record = (k: string, req: unknown) => (w.calls[k] ??= []).push(req);
  const op = (name: string, kind: string, target: string) => ({ name: `operations/${name}`, kind, target, creator: "ana" });
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs({ teams: ["web"] }, () => "web"));
    router.service(ServiceCatalogService, {
      getService: () => ({ service: tool }),
      listServices: () => ({ services: [tool] }),
      updateService: (req) => {
        record("update", req);
        return { service: { ...tool, environments: req.service?.environments ?? tool.environments } };
      },
    });
    router.service(DeployService, {
      listDeployments: () => ({
        deployments: [
          {
            name: "deployments/tool/production",
            service: "services/tool",
            env: "production",
            health: Deployment_Health.HEALTHY,
            sync: Deployment_SyncStatus.SYNCED,
            commit: COMMIT,
            image: "ghcr.io/my-org/tool:18b1232",
            version: "v0.1.0",
          },
        ],
      }),
      startDeploy: (req) => {
        record("deploy", req);
        return { operation: op("op_aaaaaaaaaaaa", "deploy", `deployments/tool/${req.env}`) };
      },
      deleteDeployment: (req) => {
        record("remove", req);
        return { operation: op("op_bbbbbbbbbbbb", "delete_deployment", req.name) };
      },
      listDeployHistory: () => ({ records: [] }),
    });
    router.service(EnvironmentService, { listEnvironments: () => ({ environments: [] }) });
    router.service(OperationService, {
      listOperations: () => ({ operations: [] }),
      getOperation: (req) => ({ operation: { name: req.name, done: true } }),
      async *watchOperation() {},
    });
    router.service(AuditService, { listAuditEvents: () => ({ events: [] }) });
    router.service(ApprovalService, { listApprovals: () => ({ approvals: [] }), listExceptions: () => ({ exceptions: [] }) });
  };
}

async function open(w: World) {
  nav.params = { name: "tool" };
  renderWithApi(<ServicePage />, forge(w));
  await screen.findByRole("heading", { name: "tool" });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

describe("serviceEnvs", () => {
  it("is both for a service that recorded none, and in deploy order", () => {
    expect(serviceEnvs({ environments: [] })).toEqual(["staging", "production"]);
    expect(serviceEnvs({ environments: ["production", "staging"] })).toEqual(["staging", "production"]);
    expect(serviceEnvs({ environments: ["production"] })).toEqual(["production"]);
  });
});

describe("a service with production only", () => {
  it("shows production, deploys there, and offers no promote", async () => {
    const w: World = { calls: {} };
    await open(w);
    expect(await screen.findByRole("heading", { name: "Production" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Staging and production" })).toBeNull();
    const table = within(screen.getByRole("table", { name: "Deployments" }));
    expect(table.queryByText("staging")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Promote/ })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Deploy to production" }));
    const dialog = screen.getByRole("dialog", { name: "Deploy tool to production?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deploy to production" }));
    await waitFor(() => expect(w.calls.deploy).toHaveLength(1));
    expect(w.calls.deploy[0]).toMatchObject({ service: "services/tool", env: "production", ref: "main" });
  });

  it("takes production down from the danger zone", async () => {
    const w: World = { calls: {} };
    await open(w);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Take down production" }));
    const dialog = screen.getByRole("dialog", { name: "Take down tool in production?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Take down production" }));
    await waitFor(() => expect(w.calls.remove).toHaveLength(1));
    expect(w.calls.remove[0]).toMatchObject({ name: "deployments/tool/production" });
  });

  it("adds staging in Settings", async () => {
    const w: World = { calls: {} };
    await open(w);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const envs = within(await screen.findByRole("group", { name: "Environments" }));
    expect((envs.getByLabelText("production") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(envs.getByLabelText("staging"));
    expect(document.body.textContent).toContain("forge service update tool --environments staging,production");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(w.calls.update).toHaveLength(1));
    expect(w.calls.update[0]).toMatchObject({ updateMask: { paths: ["environments"] }, service: { environments: ["staging", "production"] } });
  });
});
