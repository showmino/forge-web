import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { CreateStep_State, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { TemplateParameter_Type, TemplateService } from "@/gen/forge/v1/template_pb";
import { renderWithApi, signIn } from "@/test/helpers";
import CreateService from "./(app)/create/page";
import OperationPage from "./(app)/operations/[id]/page";
import Operations from "./(app)/operations/page";
import ServicePage from "./(app)/services/[name]/page";

// The writer's actions, each against an in-memory Forge API that records what
// it was asked to do. Names and shapes are the live API's.

const nav = vi.hoisted(() => ({ params: {} as Record<string, string>, router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => nav.router,
  usePathname: () => "/",
}));

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));
const COMMIT = "18b12326d3df2c1a11b9f664f378b579eb472aaf";

type World = {
  writer: boolean;
  production: Deployment_Health;
  calls: Record<string, unknown[]>;
  fail: Record<string, ConnectError>;
  // Resolved by a test to let a watched operation end.
  finish: () => void;
  history: number;
};

function world(over: Partial<World> = {}): World {
  return { writer: true, production: Deployment_Health.MISSING, calls: {}, fail: {}, finish: () => {}, history: 3, ...over };
}

const op = (id: string, kind: string, target: string, extra: object = {}) => ({
  name: `operations/${id}`,
  kind,
  target,
  creator: "ana@example.com",
  createTime: ago(1),
  ...extra,
});

function forge(w: World) {
  const record = (name: string, req: unknown) => {
    (w.calls[name] ??= []).push(req);
    if (w.fail[name]) throw w.fail[name];
  };
  return (router: ConnectRouter) => {
    router.service(AuthService, {
      getStatus: () => ({ subject: "ana", permissions: w.writer ? ["services.read", "services.write"] : ["services.read"] }),
    });
    router.service(ServiceCatalogService, {
      getService: () => ({ service: { name: "services/payments", displayName: "Payments", ownerTeam: "platform-engineering" } }),
      async *createService(req) {
        record("create", req);
        yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.STARTED } } };
        yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.DONE, detail: "nextjs@v1.3.1" } } };
        yield { event: { case: "step" as const, value: { name: "create_repo", state: CreateStep_State.STARTED } } };
        if (req.serviceId === "taken") {
          yield { event: { case: "failure" as const, value: { step: "create_repo", message: "the repo showmino/taken already exists.", rolledBack: true } } };
          return;
        }
        yield { event: { case: "step" as const, value: { name: "create_repo", state: CreateStep_State.DONE, detail: "github.com/showmino/ledger" } } };
        yield { event: { case: "service" as const, value: { name: `services/${req.serviceId}`, repoUrl: "https://github.com/showmino/ledger" } } };
      },
    });
    router.service(DeployService, {
      listDeployments: () => ({
        deployments: [
          {
            name: "deployments/payments/staging",
            service: "services/payments",
            env: "staging",
            health: Deployment_Health.HEALTHY,
            sync: Deployment_SyncStatus.SYNCED,
            commit: COMMIT,
            image: "ghcr.io/showmino/payments:18b1232",
            deployTime: ago(12),
          },
          { name: "deployments/payments/production", service: "services/payments", env: "production", health: w.production, commit: w.production === Deployment_Health.MISSING ? "" : COMMIT },
        ],
      }),
      startDeploy: (req) => {
        record("deploy", req);
        return { operation: op("op_aaaaaaaaaaaa", "deploy", "deployments/payments/staging") };
      },
      promoteDeploy: (req) => {
        record("promote", req);
        w.production = Deployment_Health.HEALTHY;
        return { operation: op("op_bbbbbbbbbbbb", "promote", "deployments/payments/production") };
      },
      listDeployHistory: (req) => {
        record("history", req);
        return {
          records: [
            { deployCommit: "c3", kind: "promote", commit: COMMIT, actor: "ana@example.com", time: ago(5) },
            { deployCommit: "c2", kind: "promote", commit: "57e0013aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "ana@example.com", time: ago(200) },
            { deployCommit: "c1", kind: "promote", commit: "9d310f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "bo@example.com", time: ago(3000) },
          ].slice(0, w.history),
        };
      },
      rollbackDeploy: (req) => {
        record("rollback", req);
        return { operation: op("op_cccccccccccc", "rollback", "deployments/payments/production") };
      },
    });
    router.service(EnvironmentService, {
      listEnvironments: () => ({
        environments: [
          { name: "environments/pr-42", service: "services/payments", ref: "feature/refunds", state: Environment_State.READY, url: "http://pr-42.preview.example.com" },
        ],
      }),
      createEnvironment: (req) => {
        record("createEnv", req);
        return { operation: op("op_dddddddddddd", "create_environment", `environments/${req.environmentId}`) };
      },
      extendEnvironment: (req) => {
        record("extend", req);
        return { environment: { name: req.name } };
      },
      destroyEnvironment: (req) => {
        record("destroy", req);
        return { operation: op("op_eeeeeeeeeeee", "destroy_environment", req.name) };
      },
    });
    router.service(AuditService, { listAuditEvents: () => ({}) });
    router.service(TemplateService, {
      listTemplates: () => ({
        templates: [
          {
            name: "templates/nextjs",
            version: "v1.3.1",
            description: "Server-rendered Next.js app",
            parameters: [
              { name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000", description: "Port the server listens on" },
              { name: "region", type: TemplateParameter_Type.ENUM, values: ["eu", "us"], required: true, defaultValue: "eu" },
              { name: "metrics", type: TemplateParameter_Type.BOOL, defaultValue: "false", description: "Expose /metrics" },
            ],
          },
          { name: "templates/go-grpc", version: "v1.3.1", description: "ConnectRPC service in Go" },
        ],
      }),
    });
    router.service(OperationService, {
      listOperations: (req) => {
        record("listOps", req);
        const all = [
          op("op_ffffffffffff", "deploy", "deployments/ledger/staging"),
          op("op_999999999999", "promote", "deployments/ledger/production", { done: true, endTime: ago(0), error: { code: "sync_timeout", message: "Argo CD did not sync in time" } }),
        ];
        return { operations: req.running ? all.filter((o) => !("done" in o)) : all };
      },
      async *watchOperation(req) {
        record("watch", req);
        const kind = req.name.endsWith("bbbbbbbbbbbb") ? "promote" : "deploy";
        yield { kind: { case: "event" as const, value: { time: ago(1), step: "render", message: "Rendered the manifests" } } };
        yield { kind: { case: "event" as const, value: { time: ago(0), step: "sync", message: "Waiting for the rollout: 1 of 2 pods ready" } } };
        await new Promise<void>((resolve) => (w.finish = resolve));
        const cancelled = (w.calls.cancel ?? []).length > 0;
        yield {
          kind: {
            case: "operation" as const,
            value: op(req.name.replace("operations/", ""), kind, "deployments/payments/production", {
              done: true,
              endTime: ago(0),
              error: cancelled ? { code: "cancelled", message: "cancelled" } : undefined,
            }),
          },
        };
      },
      cancelOperation: (req) => {
        record("cancel", req);
        setTimeout(() => w.finish(), 0);
        return { operation: op(req.name.replace("operations/", ""), "deploy", "deployments/payments/production") };
      },
    });
  };
}

const dialog = () => within(screen.getByRole("dialog"));
const click = (el: HTMLElement) => fireEvent.click(el);

async function openService(w: World) {
  nav.params = { name: "payments" };
  renderWithApi(<ServicePage />, forge(w));
  await screen.findByRole("heading", { name: "Payments" });
  await screen.findByRole("table", { name: "Previews" });
}

beforeEach(() => {
  sessionStorage.clear();
  nav.params = {};
  signIn();
});
afterEach(cleanup);

describe("who may act", () => {
  it("shows a reader no actions", async () => {
    await openService(world({ writer: false }));
    for (const name of ["Deploy to staging", "Promote to production", "Create preview", "Roll back staging", "Extend pr-42", "Destroy pr-42"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("shows a writer the actions that make sense now", async () => {
    await openService(world());
    expect(await screen.findByRole("button", { name: "Deploy to staging" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll back staging" })).toBeTruthy();
    // Production was never deployed: there is nothing to roll back there.
    expect(screen.queryByRole("button", { name: "Roll back production" })).toBeNull();
  });
});

describe("promote", () => {
  it("confirms with the facts, starts the work, shows it live and refreshes the page", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Promote to production" }));
    expect(dialog().getByRole("heading", { name: "Promote payments to production?" })).toBeTruthy();
    expect(dialog().getByText("18b1232")).toBeTruthy();
    expect(dialog().getByText("ghcr.io/showmino/payments:18b1232")).toBeTruthy();
    expect(w.calls.promote).toBeUndefined();

    click(dialog().getByRole("button", { name: "Promote to production" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(w.calls.promote).toMatchObject([{ service: "services/payments" }]);

    const log = within(await screen.findByRole("region", { name: "Operation op_bbbbbbbbbbbb" }));
    expect(await log.findByText("Waiting for the rollout: 1 of 2 pods ready")).toBeTruthy();
    expect(log.getByText("Running")).toBeTruthy();
    expect(log.getByRole("button", { name: "Cancel" })).toBeTruthy();

    w.finish();
    expect(await log.findByText("Succeeded")).toBeTruthy();
    expect(log.getByText("Promote payments to production")).toBeTruthy();
    expect(log.queryByRole("button", { name: "Cancel" })).toBeNull();
    // The page asked again: production is healthy now and can be rolled back.
    expect(await screen.findByRole("button", { name: "Roll back production" })).toBeTruthy();
  });

  it("keeps the dialog open with the reason when the API refuses", async () => {
    const w = world({ fail: { promote: new ConnectError("staging is not healthy", Code.FailedPrecondition) } });
    await openService(w);
    click(await screen.findByRole("button", { name: "Promote to production" }));
    click(dialog().getByRole("button", { name: "Promote to production" }));
    expect((await dialog().findByRole("alert")).textContent).toContain("staging is not healthy");
    expect(screen.queryByText("In progress")).toBeNull();
    // The button works again for another try.
    expect((dialog().getByRole("button", { name: "Promote to production" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does nothing on Escape or Cancel, and gives the focus back", async () => {
    const w = world();
    await openService(w);
    const opener = await screen.findByRole("button", { name: "Promote to production" });
    opener.focus();
    click(opener);
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    click(opener);
    click(dialog().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(w.calls.promote).toBeUndefined();
  });
});

describe("deploy and roll back", () => {
  it("deploys the branch the writer names", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Deploy to staging" }));
    fireEvent.change(dialog().getByLabelText("Branch, tag or commit"), { target: { value: " release-2 " } });
    click(dialog().getByRole("button", { name: "Deploy to staging" }));
    await waitFor(() => expect(w.calls.deploy).toHaveLength(1));
    expect(w.calls.deploy[0]).toMatchObject({ service: "services/payments", env: "staging", ref: "release-2" });
    expect((w.calls.deploy[0] as { requestId: string }).requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rolls back to the deploy the writer picks", async () => {
    const w = world({ production: Deployment_Health.HEALTHY });
    await openService(w);
    click(await screen.findByRole("button", { name: "Roll back production" }));
    const pick = (await dialog().findByLabelText("Go back to")) as HTMLSelectElement;
    expect(w.calls.history).toMatchObject([{ name: "deployments/payments/production" }]);
    // What runs now is not offered; the two before it are.
    expect([...pick.options].map((o) => o.value)).toEqual(["", "c2", "c1"]);
    fireEvent.change(pick, { target: { value: "c1" } });
    click(dialog().getByRole("button", { name: "Roll back production" }));
    await waitFor(() => expect(w.calls.rollback).toMatchObject([{ name: "deployments/payments/production", to: "c1" }]));
  });

  it("says so when there is nothing to go back to", async () => {
    const w = world({ production: Deployment_Health.HEALTHY, history: 1 });
    await openService(w);
    click(await screen.findByRole("button", { name: "Roll back production" }));
    expect(await dialog().findByText("There is no earlier deploy to go back to.")).toBeTruthy();
    expect((dialog().getByRole("button", { name: "Roll back production" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("previews", () => {
  it("checks the name before asking the API, then creates the preview", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Create preview" }));
    fireEvent.change(dialog().getByLabelText("Preview name"), { target: { value: "PR 42" } });
    click(dialog().getByRole("button", { name: "Create preview" }));
    expect(dialog().getByRole("alert").textContent).toContain("lowercase letters");
    expect(w.calls.createEnv).toBeUndefined();

    fireEvent.change(dialog().getByLabelText("Preview name"), { target: { value: "pr-43" } });
    fireEvent.change(dialog().getByLabelText("Branch, tag or commit"), { target: { value: "feature/x" } });
    fireEvent.change(dialog().getByLabelText("Keep it for"), { target: { value: "72" } });
    click(dialog().getByRole("button", { name: "Create preview" }));
    await waitFor(() => expect(w.calls.createEnv).toHaveLength(1));
    expect(w.calls.createEnv[0]).toMatchObject({
      environmentId: "pr-43",
      service: "services/payments",
      ref: "feature/x",
      ttl: { seconds: BigInt(72 * 3600) },
    });
  });

  it("extends and destroys a preview", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Extend pr-42" }));
    fireEvent.change(dialog().getByLabelText("Keep it for"), { target: { value: "168" } });
    click(dialog().getByRole("button", { name: "Extend preview" }));
    await waitFor(() => expect(w.calls.extend).toMatchObject([{ name: "environments/pr-42", ttl: { seconds: BigInt(168 * 3600) } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    click(screen.getByRole("button", { name: "Destroy pr-42" }));
    expect(dialog().getByText("feature/refunds")).toBeTruthy();
    click(dialog().getByRole("button", { name: "Destroy preview" }));
    await waitFor(() => expect(w.calls.destroy).toMatchObject([{ name: "environments/pr-42" }]));
    expect(await screen.findByRole("region", { name: "Operation op_eeeeeeeeeeee" })).toBeTruthy();
  });
});

describe("operations", () => {
  it("lists them with how they ended, and only the running ones on request", async () => {
    const w = world();
    renderWithApi(<Operations />, forge(w));
    const failed = within((await screen.findByText("op_999999999999")).closest("tr")!);
    expect(failed.getByText("Promote ledger to production")).toBeTruthy();
    expect(failed.getByText("Failed").closest("span")!.getAttribute("title")).toBe("Argo CD did not sync in time");
    expect(within(screen.getByText("op_ffffffffffff").closest("tr")!).getByText("Running")).toBeTruthy();

    click(screen.getByLabelText("Running only"));
    await waitFor(() => expect(screen.queryByText("op_999999999999")).toBeNull());
    expect(w.calls.listOps.at(-1)).toMatchObject({ running: true });
  });

  it("follows one operation live and cancels it", async () => {
    const w = world();
    nav.params = { id: "op_aaaaaaaaaaaa" };
    renderWithApi(<OperationPage />, forge(w));
    expect(await screen.findByText("Rendered the manifests")).toBeTruthy();
    expect(w.calls.watch).toMatchObject([{ name: "operations/op_aaaaaaaaaaaa" }]);
    click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findAllByText("Cancelled")).toHaveLength(2);
    expect(w.calls.cancel).toMatchObject([{ name: "operations/op_aaaaaaaaaaaa" }]);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("create a service", () => {
  it("asks for what the template asks for, shows each step and ends with the new service", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    fireEvent.change(await screen.findByLabelText("Service name"), { target: { value: "ledger" } });
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: " finance " } });
    // The owner starts as the person logged in; the template's defaults are filled in.
    expect((screen.getByLabelText("Owners") as HTMLInputElement).value).toBe("ana@example.com");
    expect((screen.getByLabelText("port (optional)") as HTMLInputElement).value).toBe("3000");
    fireEvent.change(screen.getByLabelText("port (optional)"), { target: { value: "8080" } });
    click(screen.getByLabelText(/metrics/));
    click(screen.getByRole("button", { name: "Create service" }));

    expect(await screen.findByRole("heading", { name: "ledger was created" })).toBeTruthy();
    expect(screen.getByText("Fetched template nextjs@v1.3.1")).toBeTruthy();
    expect(screen.getByText("Created github.com/showmino/ledger")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open ledger" }).getAttribute("href")).toBe("/services/ledger");
    expect(w.calls.create[0]).toMatchObject({
      serviceId: "ledger",
      template: "templates/nextjs",
      ownerTeam: "finance",
      owners: ["ana@example.com"],
      parameters: { port: "8080", region: "eu", metrics: "true" },
    });
  });

  it("refuses a bad name before asking the API", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    fireEvent.change(await screen.findByLabelText("Service name"), { target: { value: "My Service" } });
    click(screen.getByRole("button", { name: "Create service" }));
    expect(screen.getByRole("alert").textContent).toContain("lowercase letters");
    expect(w.calls.create).toBeUndefined();
  });

  it("says what failed and whether anything was left behind", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    fireEvent.change(await screen.findByLabelText("Service name"), { target: { value: "taken" } });
    click(screen.getByRole("button", { name: "Create service" }));
    const alert = await screen.findByText(/already exists/);
    expect(alert.textContent).toContain("Nothing was left behind");
    expect(screen.getByText("Creating the repo failed")).toBeTruthy();
    // The form is still there for another try.
    expect((screen.getByRole("button", { name: "Create service" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("switches the questions with the template, and tells a reader they cannot create", async () => {
    const w = world({ writer: false });
    renderWithApi(<CreateService />, forge(w));
    await screen.findByLabelText("port (optional)");
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "templates/go-grpc" } });
    expect(screen.queryByLabelText("port (optional)")).toBeNull();
    expect(screen.getByText(/Only writers can create a service/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create service" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
