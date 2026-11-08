import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Resource_State, ResourcePlan_State, type ResourcePlanSchema, type ResourceSchema, ResourceService } from "@/gen/forge/v1/resource_pb";
import { ADMIN, authAs, READER, renderWithApi, signIn, type Caller } from "@/test/helpers";
import ServicePage from "./(app)/services/[name]/page";

// The Resources tab of a service page: its databases, their plans, and
// applying a plan, against an in-memory Forge API with the live API's names
// and shapes (resources/{service}/{env}/{name}, resourcePlans/{id}).

const nav = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const payments = {
  name: "services/payments",
  displayName: "Payments",
  ownerTeam: "platform-engineering",
  lifecycle: Lifecycle.PRODUCTION,
  repoUrl: "https://github.com/my-org/payments",
};
const in1h = timestampFromDate(new Date(Date.now() + 3600_000));
const ago = (m: number) => timestampFromDate(new Date(Date.now() - m * 60_000));
const db = { name: "db", type: "postgres", storageGi: 10, instances: 1 };

const ready = {
  name: "resources/payments/staging/db",
  service: "services/payments",
  env: "staging",
  type: "postgres",
  settings: db,
  state: Resource_State.READY,
  health: { phase: "Cluster in healthy state", readyInstances: 1, instances: 1 },
  secret: "payments-db-app",
};
const stagingPlan = {
  name: "resourcePlans/7f3a91c2b04e",
  service: "services/payments",
  env: "staging",
  state: ResourcePlan_State.PLANNED,
  changes: [{ action: "update", resource: "db", type: "postgres", before: db, after: { ...db, storageGi: 20 } }],
  policy: { denied: false, warn: ["storage above 15Gi costs more"] },
  creator: "ana@example.com",
  createTime: ago(5),
  expireTime: in1h,
};
const productionPlan = { ...stagingPlan, name: "resourcePlans/0c1d2e3f4a5b", env: "production", changes: [{ action: "create", resource: "db", type: "postgres", after: db }], policy: { denied: false } };
const dropPlan = { ...stagingPlan, name: "resourcePlans/aaaaaaaaaaaa", changes: [{ action: "delete", resource: "db", type: "postgres", before: db }], policy: { denied: false }, allowDestroy: true };
const deniedPlan = { ...stagingPlan, name: "resourcePlans/bbbbbbbbbbbb", state: ResourcePlan_State.DENIED, policy: { denied: true, deny: ["production needs 2 instances"] } };
const expiredPlan = { ...stagingPlan, name: "resourcePlans/cccccccccccc", expireTime: ago(1) };

type World = { caller: Caller; resources: MessageInitShape<typeof ResourceSchema>[]; plans: MessageInitShape<typeof ResourcePlanSchema>[]; calls: Record<string, unknown[]>; fail?: ConnectError };
const world = (over: Partial<World> = {}): World => ({ caller: { teams: ["platform-engineering"] }, resources: [ready], plans: [stagingPlan], calls: {}, ...over });

function forge(w: World) {
  const record = (k: string, req: unknown) => (w.calls[k] ??= []).push(req);
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller, () => "platform-engineering"));
    router.service(ServiceCatalogService, { getService: () => ({ service: payments }), listServices: () => ({ services: [payments] }) });
    router.service(DeployService, { listDeployments: () => ({ deployments: [] }) });
    router.service(EnvironmentService, { listEnvironments: () => ({ environments: [] }) });
    router.service(OperationService, {
      listOperations: () => ({ operations: [] }),
      getOperation: (req) => ({ operation: { name: req.name, kind: "resource.apply", target: "resources/payments/staging", done: false } }),
    });
    router.service(AuditService, { listAuditEvents: () => ({ events: [] }) });
    router.service(ResourceService, {
      listResources: (req) => {
        record("listResources", req);
        return { resources: w.resources };
      },
      listResourcePlans: () => ({ plans: w.plans }),
      applyResourcePlan: (req) => {
        record("applyResourcePlan", req);
        if (w.fail) throw w.fail;
        return { operation: { name: "operations/op-apply-1", kind: "resource.apply", target: "resources/payments/staging" } };
      },
    });
  };
}

async function openResources(w: World) {
  nav.params = { name: "payments" };
  renderWithApi(<ServicePage />, forge(w));
  await screen.findByRole("heading", { name: "payments" });
  fireEvent.click(await screen.findByRole("tab", { name: "Resources" }));
  await screen.findByRole("table", { name: "Plans" });
}

// settled waits until the API has said what the caller may do, so a check for
// a missing button cannot pass before the answer arrives.
async function settled() {
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

describe("the Resources tab", () => {
  it("lists the databases with their live health", async () => {
    await openResources(world());
    const row = within(screen.getByRole("table", { name: "Resources" })).getAllByRole("row")[1];
    expect(row.textContent).toContain("db");
    expect(row.textContent).toContain("postgres, 10 Gi, 1 instance");
    expect(row.textContent).toContain("Healthy");
    expect(row.textContent).toContain("1/1 ready, Cluster in healthy state");
    expect(row.textContent).toContain("payments-db-app");
    const cli = screen.getAllByTitle("Same action from the terminal").map((c) => c.textContent).join("\n");
    expect(cli).toContain("forge resource list payments");
  });

  it("is not there for a service with no resources and no plans", async () => {
    const w = world({ resources: [], plans: [] });
    nav.params = { name: "payments" };
    renderWithApi(<ServicePage />, forge(w));
    await screen.findByRole("heading", { name: "payments" });
    await waitFor(() => expect(w.calls.listResources).toBeTruthy());
    await settled();
    expect(screen.queryByRole("tab", { name: "Resources" })).toBeNull();
  });

  it("shows why policy denies a plan, and offers no Apply for it or an expired one", async () => {
    await openResources(world({ plans: [deniedPlan, expiredPlan] }));
    await settled();
    expect(screen.getByText("production needs 2 instances")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Apply plan/ })).toBeNull();
  });
});

describe("applying a plan", () => {
  it("shows the changes and warnings, applies, and follows the run", async () => {
    const w = world();
    await openResources(w);
    fireEvent.click(await screen.findByRole("button", { name: "Apply plan 7f3a91c2b04e" }));
    const dialog = screen.getByRole("dialog", { name: "Apply plan 7f3a91c2b04e to staging?" });
    expect(within(dialog).getByRole("list", { name: "Changes" }).textContent).toContain(
      "~ update db: postgres, 10 Gi, 1 instance → postgres, 20 Gi, 1 instance",
    );
    expect(within(dialog).getByRole("list", { name: "Warnings" }).textContent).toContain("storage above 15Gi costs more");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply to staging" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(w.calls.applyResourcePlan).toEqual([expect.objectContaining({ name: "resourcePlans/7f3a91c2b04e" })]);
    expect(await screen.findByRole("heading", { name: "In progress" })).toBeTruthy();
  });

  it("asks for the database's name before a plan that deletes it", async () => {
    const w = world({ plans: [dropPlan] });
    await openResources(w);
    fireEvent.click(await screen.findByRole("button", { name: "Apply plan aaaaaaaaaaaa" }));
    const dialog = screen.getByRole("dialog");
    const apply = within(dialog).getByRole("button", { name: "Apply to staging" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type db to delete it and its data"), { target: { value: "dbx" } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type db to delete it and its data"), { target: { value: "db" } });
    expect(apply.disabled).toBe(false);
  });

  it("keeps the dialog open with the API's reason when it refuses", async () => {
    const w = world({ fail: new ConnectError("forge.yaml changed since the plan was made: plan again", Code.FailedPrecondition) });
    await openResources(w);
    fireEvent.click(await screen.findByRole("button", { name: "Apply plan 7f3a91c2b04e" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to staging" }));
    expect((await screen.findByRole("alert")).textContent).toContain("plan again");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("who may apply", () => {
  it("lets the service's team apply staging but not production", async () => {
    await openResources(world({ plans: [stagingPlan, productionPlan] }));
    expect(await screen.findByRole("button", { name: "Apply plan 7f3a91c2b04e" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply plan 0c1d2e3f4a5b" })).toBeNull();
  });

  it("lets an admin apply production", async () => {
    await openResources(world({ caller: ADMIN, plans: [productionPlan] }));
    expect(await screen.findByRole("button", { name: "Apply plan 0c1d2e3f4a5b" })).toBeTruthy();
  });

  it("shows a reader the plans but no Apply", async () => {
    await openResources(world({ caller: READER }));
    await settled();
    expect(screen.getByRole("table", { name: "Plans" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Apply plan/ })).toBeNull();
  });
});
