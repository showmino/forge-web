import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { CreateStep_State, Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Bump, Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { TemplateParameter_Type, TemplateService } from "@/gen/forge/v1/template_pb";
import { ADMIN, authAs, READER, renderWithApi, signIn, type Caller } from "@/test/helpers";
import CreateService from "./(app)/create/page";
import TemplateCreate from "./(app)/templates/[name]/create/page";
import Environments from "./(app)/environments/page";
import OperationPage from "./(app)/operations/[id]/page";
import Operations from "./(app)/operations/page";
import ServicePage from "./(app)/services/[name]/page";

// The writer's actions, each against an in-memory Forge API that records what
// it was asked to do. Names and shapes are the live API's.

const nav = vi.hoisted(() => ({ params: {} as Record<string, string>, search: "", router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => nav.router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));
const COMMIT = "18b12326d3df2c1a11b9f664f378b579eb472aaf";
const payments = {
  name: "services/payments",
  displayName: "Payments",
  ownerTeam: "platform-engineering",
  owners: ["ana@example.com"],
  lifecycle: Lifecycle.EXPERIMENTAL,
  repoUrl: "https://github.com/showmino/payments",
  etag: 'W/"3"',
};

type World = {
  writer: boolean;
  // Who calls, when not an admin (writer) or a reader.
  caller?: Caller;
  production: Deployment_Health;
  calls: Record<string, unknown[]>;
  fail: Record<string, ConnectError>;
  // Resolved by a test to let a watched operation end.
  finish: () => void;
  history: number;
  // What staging runs when the promote dialog asks; the page shows COMMIT.
  stagingNow: string;
  // How many times a stream drops before it works.
  dropCreate: number;
  dropWatch: number;
  // The App may not read the organization's teams.
  teamsDenied: boolean;
  // Whether the service runs anything: a delete is then an operation.
  deleteRuns: boolean;
  // How a watched operation ends, when not well.
  opError?: { code: string; message: string };
  // Whether the API cuts versions: staging then runs a release candidate.
  versions: boolean;
};

function world(over: Partial<World> = {}): World {
  return { writer: true, production: Deployment_Health.MISSING, calls: {}, fail: {}, finish: () => {}, history: 3, stagingNow: COMMIT, dropCreate: 0, dropWatch: 0, teamsDenied: false, deleteRuns: true, versions: false, ...over };
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
  const ended = new Map<string, ReturnType<typeof op>>();
  const record = (name: string, req: unknown) => {
    (w.calls[name] ??= []).push(req);
    if (w.fail[name]) throw w.fail[name];
  };
  return (router: ConnectRouter) => {
    const teamOf = (service: string) => (service === payments.name ? payments.ownerTeam : service === "services/ledger" ? "finance" : "");
    const auth = authAs(w.caller ?? (w.writer ? ADMIN : READER), teamOf);
    router.service(AuthService, {
      ...auth,
      testPermissions: (req) => {
        record("testPermissions", req);
        return auth.testPermissions(req);
      },
    });
    router.service(ServiceCatalogService, {
      getService: () => ({ service: payments }),
      listServices: () => ({ services: [payments, { name: "services/ledger", ownerTeam: "finance" }] }),
      updateService: (req) => {
        record("update", req);
        const s = req.service!;
        return { service: { ...payments, ownerTeam: s.ownerTeam, owners: s.owners, lifecycle: s.lifecycle, etag: 'W/"4"' } };
      },
      deleteService: (req) => {
        record("delete", req);
        return w.deleteRuns ? { operation: op("op_111111111111", "delete_service", "services/payments") } : {};
      },
      async *createService(req) {
        record("create", req);
        yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.STARTED } } };
        if (w.dropCreate-- > 0) throw new ConnectError("connection reset", Code.Unavailable);
        yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.DONE, detail: "nextjs@v1.3.1" } } };
        if (req.template === "templates/landing-zone") {
          yield { event: { case: "step" as const, value: { name: "pull_request", state: CreateStep_State.DONE, detail: "https://github.com/showmino/landingzone/pull/4" } } };
          yield {
            event: {
              case: "change" as const,
              value: {
                repoUrl: "https://github.com/showmino/landingzone",
                branch: `forge/landing-zone-${req.serviceId}`,
                pullRequestUrl: "https://github.com/showmino/landingzone/pull/4",
                files: [`landingZones/Corp/lz-corp-${req.serviceId}.bicepparam`],
              },
            },
          };
          return;
        }
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
            version: w.versions ? "v0.3.1-rc.2" : "",
            argoUrl: "https://argocd.example.com/applications/argocd/payments-staging",
          },
          { name: "deployments/payments/production", service: "services/payments", env: "production", health: w.production, commit: w.production === Deployment_Health.MISSING ? "" : COMMIT, argoUrl: "javascript:alert(1)" },
        ],
      }),
      startDeploy: (req) => {
        record("deploy", req);
        return { operation: op("op_aaaaaaaaaaaa", "deploy", "deployments/payments/staging") };
      },
      promoteDeploy: (req) => {
        // As the API: a dry run says what production would run, and changes nothing.
        if (req.validateOnly) {
          record("promoteCheck", req);
          const version = !w.versions ? "" : req.bump === Bump.MAJOR ? "v1.0.0" : req.bump === Bump.MINOR ? "v0.4.0" : "v0.3.1";
          return { deployment: { name: "deployments/payments/production", env: "production", commit: w.stagingNow, image: `ghcr.io/showmino/payments:${w.stagingNow.slice(0, 7)}`, version } };
        }
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
      setAddress: (req) => {
        // As the API: the root of pay.example is in use; a dry run changes nothing.
        record(req.validateOnly ? "addressCheck" : "address", req);
        const root = req.host === "@";
        const domain = req.domain || "example.com";
        return {
          service: payments,
          addresses: [
            { env: "staging", url: `https://${root ? `staging.${domain}` : `payments-staging.${domain}`}`, public: true, currentUrl: "https://payments-staging.example.com", host: root ? `staging.${domain}` : `payments-staging.${domain}` },
            { env: "production", url: `https://${root ? domain : `payments.${domain}`}`, public: true, inUse: root, host: root ? domain : `payments.${domain}` },
          ],
        };
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
    router.service(TeamService, {
      listTeams: () => {
        if (w.teamsDenied) {
          throw new ConnectError('the Forge GitHub App may not read the organization\'s teams: grant it the organization permission "Members: read"', Code.FailedPrecondition);
        }
        return {
          teams: [
            { name: "teams/finance", displayName: "Finance", description: "Ledger and payouts" },
            { name: "teams/platform-engineering", displayName: "Platform Engineering" },
          ],
        };
      },
    });
    router.service(TemplateService, {
      listTemplates: () => ({
        templates: [
          {
            name: "templates/nextjs",
            version: "v1.3.1",
            description: "Server-rendered Next.js app",
            parameters: [
              { name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000", description: "Port the server listens on" },
              { name: "region", type: TemplateParameter_Type.ENUM, values: ["eu", "us"], required: true },
              { name: "module", type: TemplateParameter_Type.STRING, defaultValue: "github.com/{% .Repo.Owner %}/{% .Repo.Name %}", pattern: "^[a-z0-9./-]+$" },
              { name: "metrics", type: TemplateParameter_Type.BOOL, defaultValue: "false", description: "Expose /metrics" },
            ],
            options: ["replicas", "env", "jobs"],
          },
          { name: "templates/go-grpc", version: "v1.3.1", description: "ConnectRPC service in Go" },
          {
            name: "templates/landing-zone",
            version: "v1.7.0",
            title: "Landing zone",
            description: "An Azure subscription",
            type: "file",
            targetRepo: "showmino/landingzone",
            parameters: [
              { name: "type", label: "LandingZone Arc Type", type: TemplateParameter_Type.ENUM, values: ["corp", "online"], required: true },
              { name: "environments", label: "Environments", type: TemplateParameter_Type.LIST, values: ["prod", "staging", "dev", "test"], defaultValue: "prod" },
              { name: "ipAddresses", label: "IP addresses needed", type: TemplateParameter_Type.INT, required: true, min: BigInt(1), max: BigInt(1024), placeholder: "1 - 1024" },
              { name: "costCenter", label: "Cost center", type: TemplateParameter_Type.STRING, required: true, group: "Tags", placeholder: "Enter cost center" },
            ],
          },
          {
            name: "templates/opentofu",
            version: "v1.3.1",
            title: "OpenTofu stack",
            description: "OpenTofu module",
            parameters: [
              { name: "state_bucket", type: TemplateParameter_Type.STRING, required: true, pattern: "^[a-z0-9-]+$" },
              { name: "size", type: TemplateParameter_Type.INT, required: true },
              { name: "public", type: TemplateParameter_Type.BOOL, required: true },
              { name: "retries", type: TemplateParameter_Type.INT, defaultValue: "3" },
            ],
          },
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
        const deleting = req.name.endsWith("111111111111");
        const kind = deleting ? "delete_service" : req.name.endsWith("bbbbbbbbbbbb") ? "promote" : "deploy";
        yield { kind: { case: "event" as const, value: { time: ago(1), step: "render", message: "Rendered the manifests" } } };
        if (w.dropWatch-- > 0) throw new ConnectError("connection reset", Code.Unavailable);
        yield { kind: { case: "event" as const, value: { time: ago(0), step: "sync", message: "Waiting for the rollout: 1 of 2 pods ready" } } };
        // As the API: watching an operation that has ended replays it and ends at once.
        if (!ended.has(req.name)) {
          await new Promise<void>((resolve) => (w.finish = resolve));
          const cancelled = (w.calls.cancel ?? []).length > 0;
          ended.set(
            req.name,
            op(req.name.replace("operations/", ""), kind, deleting ? "services/payments" : "deployments/payments/production", {
              done: true,
              endTime: ago(0),
              error: cancelled ? { code: "cancelled", message: "cancelled" } : w.opError,
            }),
          );
        }
        yield { kind: { case: "operation" as const, value: ended.get(req.name)! } };
      },
      cancelOperation: (req) => {
        record("cancel", req);
        setTimeout(() => w.finish(), 0);
        return { operation: op(req.name.replace("operations/", ""), "deploy", "deployments/payments/production") };
      },
      getOperation: (req) => {
        const id = req.name.replace("operations/", "");
        if (ended.has(req.name)) return { operation: ended.get(req.name) };
        const target = id === "op_111111111111" ? "services/payments" : id === "op_aaaaaaaaaaaa" ? "deployments/payments/staging" : "deployments/payments/production";
        return { operation: op(id, "deploy", target) };
      },
    });
  };
}

const dialog = () => within(screen.getByRole("dialog"));

// fillCreate gives the create form its two required answers: a name, and the owner picked from GitHub's teams.
// The create form is a few steps: the template, the details, where it is
// reached, how it runs, then a review with the Create button.
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
async function pickTemplate(id: string) {
  fireEvent.click(await screen.findByRole("radio", { name: new RegExp(`^${id}\\b`) }));
}
async function fillCreate(name: string, team = "finance", template?: string) {
  if (template) await pickTemplate(template);
  else await screen.findByRole("radio", { name: /^nextjs/ });
  next();
  fireEvent.change(screen.getByLabelText(/^(Service name|Name)$/), { target: { value: name } });
  await screen.findByRole("option", { name: /^finance/ });
  fireEvent.change(screen.getByLabelText(/^(Owner|GitHub team)$/), { target: { value: team } });
}
function toReview() {
  for (let i = 0; i < 6 && screen.queryByRole("button", { name: "Continue" }); i++) next();
}
// The page's own promote button names the commit staging runs; the dialog's says where it goes.
const PROMOTE = "Promote 18b1232 to production";
const click = (el: HTMLElement) => fireEvent.click(el);

// permissionsAnswered waits until the API has said what the caller may do on
// the service ("" for none) and the page has rendered the answer, so that a
// check for a missing button cannot pass before the answer arrives.
async function permissionsAnswered(w: World, service: string) {
  await waitFor(() => expect((w.calls.testPermissions ?? []).some((r) => (r as { service: string }).service === service)).toBe(true));
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

async function openService(w: World) {
  nav.params = { name: "payments" };
  renderWithApi(<ServicePage />, forge(w));
  await screen.findByRole("heading", { name: "payments" });
  await screen.findByRole("list", { name: "Previews" });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  nav.params = {};
  signIn();
});
afterEach(cleanup);

describe("who may act", () => {
  it("shows a reader no actions", async () => {
    await openService(world({ writer: false }));
    for (const name of ["Deploy to staging", PROMOTE, "Preview env", "Roll back staging", "Extend pr-42", "Destroy pr-42", "Delete service"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Service settings" })).toBeNull();
  });

  it("shows a member of the service's team its work, but not an admin's", async () => {
    // payments belongs to platform-engineering; this caller is in it, and no admin.
    await openService(world({ caller: { teams: ["platform-engineering"] } }));
    expect(await screen.findByRole("button", { name: "Deploy to staging" })).toBeTruthy();
    expect(screen.getByRole("button", { name: PROMOTE })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll back staging" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview env" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extend pr-42" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Destroy pr-42" })).toBeTruthy();

    click(screen.getByRole("button", { name: "Service settings" }));
    expect(screen.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected")).toBe("true");
    // Moving the service to another team, its address and deleting it are an admin's.
    const team = screen.getByLabelText("Owning team") as HTMLInputElement;
    expect(team.readOnly).toBe(true);
    expect(team.value).toBe("platform-engineering");
    expect(screen.getByText("Only an admin can move a service to another team.")).toBeTruthy();
    expect(screen.getByText("Only an admin can point the service at another repository.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Danger zone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change address" })).toBeNull();
    // The rest of the settings are the team's.
    expect((screen.getByLabelText("Contacts") as HTMLInputElement).readOnly).toBe(false);
  });

  it("shows a member of another team no actions on the service", async () => {
    const w = world({ caller: { teams: ["finance"] } });
    await openService(w);
    await permissionsAnswered(w, "services/payments");
    for (const name of ["Deploy to staging", PROMOTE, "Preview env", "Roll back staging", "Extend pr-42", "Destroy pr-42", "Service settings"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows a writer the actions that make sense now", async () => {
    await openService(world());
    expect(await screen.findByRole("button", { name: "Deploy to staging" })).toBeTruthy();
    // Staging runs a commit production does not: promoting it is the one primary action.
    expect(screen.getByRole("button", { name: PROMOTE }).textContent).toBe("Promote 18b1232");
    expect(screen.getByText("Staging is ahead of production")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll back staging" })).toBeTruthy();
    // The page names its command, as every Forge screen does.
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge service get payments");
    // Production was never deployed: there is nothing to roll back there.
    expect(screen.queryByRole("button", { name: "Roll back production" })).toBeNull();
  });
});

describe("promote", () => {
  it("confirms with the facts, starts the work, shows it live and refreshes the page", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: PROMOTE }));
    expect(dialog().getByRole("heading", { name: "Promote payments to production?" })).toBeTruthy();
    // Nothing can be confirmed until the API has said what staging runs now.
    expect((dialog().getByRole("button", { name: "Promote to production" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await dialog().findByText("18b1232")).toBeTruthy();
    expect(dialog().getByText("ghcr.io/showmino/payments:18b1232")).toBeTruthy();
    expect(w.calls.promoteCheck).toMatchObject([{ service: "services/payments", validateOnly: true }]);
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
    // The page asked again: production is healthy now and can be rolled back,
    // and with both on the same commit there is nothing left to promote.
    expect(await screen.findByRole("button", { name: "Roll back production" })).toBeTruthy();
    expect(screen.getByText("Both run the same commit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: PROMOTE })).toBeNull();
  });

  it("names the version it cuts and lets the writer pick how far it goes up", async () => {
    const w = world({ versions: true });
    await openService(w);
    // The page names staging's build by its version, next to the commit.
    click(await screen.findByRole("button", { name: "Promote v0.3.1-rc.2 to production" }));
    const table = within(screen.getByRole("table", { name: "Deployments" }));
    expect(table.getByText("v0.3.1-rc.2")).toBeTruthy();
    expect(table.getByText("18b1232")).toBeTruthy();

    // A patch unless something else is picked.
    expect(await dialog().findByRole("button", { name: "Promote as v0.3.1" })).toBeTruthy();
    expect((dialog().getByRole("radio", { name: /Patch/ }) as HTMLInputElement).checked).toBe(true);
    expect(dialog().getByText("v0.3.1-rc.2")).toBeTruthy();
    click(dialog().getByRole("radio", { name: /Minor/ }));
    click(await dialog().findByRole("button", { name: "Promote as v0.4.0" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(w.calls.promoteCheck).toMatchObject([{ bump: Bump.PATCH }, { bump: Bump.MINOR }]);
    expect(w.calls.promote).toMatchObject([{ service: "services/payments", bump: Bump.MINOR }]);
  });

  it("offers no pick when the API cuts no versions", async () => {
    await openService(world());
    click(await screen.findByRole("button", { name: PROMOTE }));
    await dialog().findByText("18b1232");
    expect(dialog().queryByRole("radio")).toBeNull();
    expect(dialog().queryByText("Version")).toBeNull();
  });

  it("keeps the dialog open with the reason when the API refuses", async () => {
    const w = world({ fail: { promote: new ConnectError("staging is not healthy", Code.FailedPrecondition) } });
    await openService(w);
    click(await screen.findByRole("button", { name: PROMOTE }));
    await dialog().findByText("18b1232");
    click(dialog().getByRole("button", { name: "Promote to production" }));
    expect((await dialog().findByRole("alert")).textContent).toContain("staging is not healthy");
    expect(screen.queryByText("In progress")).toBeNull();
    // The button works again for another try.
    expect((dialog().getByRole("button", { name: "Promote to production" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows what staging runs now, not what the page showed when it loaded", async () => {
    const w = world({ stagingNow: "9c1e2faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    await openService(w);
    click(await screen.findByRole("button", { name: PROMOTE }));
    expect(await dialog().findByText("ghcr.io/showmino/payments:9c1e2fa")).toBeTruthy();
    expect(dialog().getByRole("status").textContent).toContain("it now runs 9c1e2fa, not 18b1232");
  });

  it("does nothing on Escape or Cancel, and gives the focus back", async () => {
    const w = world();
    await openService(w);
    const opener = await screen.findByRole("button", { name: PROMOTE });
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

describe("delete a service", () => {
  // Delete is in the danger zone of the service's settings.
  async function openDelete() {
    click(await screen.findByRole("button", { name: "Service settings" }));
    click(await screen.findByRole("button", { name: "Delete service" }));
  }

  it("says what goes and what stays, asks for the name, and shows the teardown to its end", async () => {
    const w = world();
    await openService(w);
    await openDelete();
    expect(dialog().getByRole("heading", { name: "Delete payments?" })).toBeTruthy();
    const text = screen.getByRole("dialog").textContent!;
    expect(text).toContain("its staging deployment and the namespace payments-staging");
    expect(text).not.toContain("payments-production"); // production was never deployed
    expect(text).toContain("its preview (pr-42)");
    expect(text).toContain("Its GitHub repo is kept.");

    // The name is typed to confirm, as on the CLI: until it matches, nothing can be deleted.
    const confirm = dialog().getByRole("button", { name: "Delete service" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payment" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(confirm.closest("form")!);
    expect(w.calls.delete).toBeUndefined();
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payments" } });
    expect(confirm.disabled).toBe(false);
    click(confirm);

    await waitFor(() => expect(w.calls.delete).toMatchObject([{ name: "services/payments" }]));
    expect(await screen.findByText(/This service is being deleted/)).toBeTruthy();
    const log = within(await screen.findByRole("region", { name: "Operation op_111111111111" }));
    expect(await log.findByText("Rendered the manifests")).toBeTruthy();
    // While it is being deleted the page offers nothing else to do to it.
    expect(screen.queryByRole("button", { name: "Deploy to staging" })).toBeNull();

    await waitFor(
      () => {
        w.finish();
        expect(screen.getByText(/This service was deleted/)).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole("link", { name: "Back to the services" }).getAttribute("href")).toBe("/services");
  });

  it("goes back to the list at once when the service ran nothing", async () => {
    const w = world({ deleteRuns: false });
    await openService(w);
    nav.router.replace.mockClear();
    await openDelete();
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payments" } });
    click(dialog().getByRole("button", { name: "Delete service" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/services"));
  });

  it("brings the service back, with the reason, when the delete fails half way", async () => {
    const w = world({ opError: { code: "sync_timeout", message: "Argo CD still has the application payments-staging after 10m0s" } });
    await openService(w);
    await openDelete();
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payments" } });
    click(dialog().getByRole("button", { name: "Delete service" }));
    await screen.findByText(/This service is being deleted/);
    // It did not work: the service is still there, the log says why, and it can be deleted again.
    await waitFor(
      () => {
        w.finish();
        expect(screen.getByRole("button", { name: "Delete service" })).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText("Argo CD still has the application payments-staging after 10m0s")).toBeTruthy();
    expect(screen.queryByText(/This service was deleted/)).toBeNull();
  });

  it("keeps the dialog open with the reason when the API refuses", async () => {
    const w = world({ fail: { delete: new ConnectError("services/payments is a dependency of services/checkout", Code.FailedPrecondition) } });
    await openService(w);
    await openDelete();
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payments" } });
    click(dialog().getByRole("button", { name: "Delete service" }));
    expect((await dialog().findByRole("alert")).textContent).toContain("is a dependency of services/checkout");
  });
});

describe("argo cd links", () => {
  it("links each deployment to Argo CD, and never to anything but a web address", async () => {
    await openService(world());
    const link = await screen.findByRole("link", { name: "staging in Argo CD" });
    expect(link.getAttribute("href")).toBe("https://argocd.example.com/applications/argocd/payments-staging");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "production in Argo CD" })).toBeNull();
  });

  it("links the About panel to all the service's Applications", async () => {
    await openService(world());
    const link = await screen.findByRole("link", { name: "All payments apps" });
    expect(link.getAttribute("href")).toBe("https://argocd.example.com/applications?search=payments");
  });

  it("links a running deploy to its Application", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Deploy to staging" }));
    click(dialog().getByRole("button", { name: "Deploy to staging" }));
    const log = within(await screen.findByRole("region", { name: "Operation op_aaaaaaaaaaaa" }));
    const link = await log.findByRole("link", { name: /payments-staging/ });
    expect(link.getAttribute("href")).toBe("https://argocd.example.com/applications/argocd/payments-staging");
  });
});

describe("change the address", () => {

  it("plans first, makes the writer type each address in use and the name, then sets it", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Service settings" }));
    expect(screen.getByRole("region", { name: "Danger zone" }).textContent).toContain("Comes from forge.yaml.");
    click(screen.getByRole("button", { name: "Change address" }));
    expect(dialog().getByRole("heading", { name: "Change the address of payments?" })).toBeTruthy();
    // Nothing can be changed before the plan is shown.
    expect(dialog().queryByRole("button", { name: "Change address" })).toBeNull();

    click(dialog().getByLabelText(/The domain itself/));
    fireEvent.change(dialog().getByLabelText("Domain"), { target: { value: "pay.example" } });
    click(dialog().getByRole("button", { name: "Show where it goes" }));
    await waitFor(() => expect(w.calls.addressCheck).toMatchObject([{ service: "services/payments", host: "@", domain: "pay.example", validateOnly: true }]));
    expect(await dialog().findByText("https://pay.example")).toBeTruthy();
    expect(dialog().getByText(/now https:\/\/payments-staging.example.com, which stops working/)).toBeTruthy();

    const confirm = dialog().getByRole("button", { name: "Change address" }) as HTMLButtonElement;
    fireEvent.change(dialog().getByLabelText("Type payments to confirm"), { target: { value: "payments" } });
    expect(confirm.disabled).toBe(true); // pay.example is in use: it must be typed too
    fireEvent.change(dialog().getByLabelText(/pay.example is in use already/), { target: { value: "pay.example" } });
    expect(confirm.disabled).toBe(false);
    click(confirm);
    await waitFor(() =>
      expect(w.calls.address).toMatchObject([{ service: "services/payments", host: "@", domain: "pay.example", claim: ["pay.example"], etag: 'W/"3"' }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for a new plan when the choice changes", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Service settings" }));
    click(screen.getByRole("button", { name: "Change address" }));
    click(dialog().getByRole("button", { name: "Show where it goes" }));
    expect(await dialog().findByText("https://payments.example.com")).toBeTruthy();
    fireEvent.change(dialog().getByLabelText("Domain"), { target: { value: "other.io" } });
    expect(dialog().queryByRole("button", { name: "Change address" })).toBeNull();
    expect(dialog().getByRole("button", { name: "Show where it goes" })).toBeTruthy();
    expect(w.calls.address).toBeUndefined();
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

  it("names the deploy it goes back to, even when the writer takes the first offer", async () => {
    const w = world({ production: Deployment_Health.HEALTHY });
    await openService(w);
    click(await screen.findByRole("button", { name: "Roll back production" }));
    await dialog().findByLabelText("Go back to");
    click(dialog().getByRole("button", { name: "Roll back production" }));
    await waitFor(() => expect(w.calls.rollback).toMatchObject([{ to: "c2" }]));
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
    click(await screen.findByRole("button", { name: "Preview env" }));
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

    // The chips count each kind and filter the table; the command follows.
    const cli = () => screen.getByTitle("Same action from the terminal").textContent;
    click(screen.getByRole("button", { name: "In progress 1" }));
    expect(screen.queryByText("op_999999999999")).toBeNull();
    expect(screen.getByText("op_ffffffffffff")).toBeTruthy();
    expect(cli()).toContain("forge op list --running");
    click(screen.getByRole("button", { name: "Failed 1" }));
    expect(screen.getByText("op_999999999999")).toBeTruthy();
    expect(screen.queryByText("op_ffffffffffff")).toBeNull();
    click(screen.getByRole("button", { name: "Succeeded 0" }));
    expect(screen.getByText("No operations match this filter.")).toBeTruthy();
  });

  it("follows one operation live and cancels it", async () => {
    const w = world();
    nav.params = { id: "op_aaaaaaaaaaaa" };
    renderWithApi(<OperationPage />, forge(w));
    expect(await screen.findByText("Rendered the manifests")).toBeTruthy();
    expect(w.calls.watch).toMatchObject([{ name: "operations/op_aaaaaaaaaaaa" }]);
    // Cancelling asks first: the work may leave its target half way.
    click(await screen.findByRole("button", { name: "Cancel" }));
    expect(dialog().getByRole("heading").textContent).toMatch(/^Cancel /);
    click(dialog().getByRole("button", { name: "Keep it running" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(w.calls.cancel).toBeUndefined();
    click(screen.getByRole("button", { name: "Cancel" }));
    click(dialog().getByRole("button", { name: "Cancel operation" }));
    expect(await screen.findAllByText("Cancelled")).toHaveLength(2);
    expect(w.calls.cancel).toMatchObject([{ name: "operations/op_aaaaaaaaaaaa" }]);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("watches again when the connection drops, and still sees the end", async () => {
    const w = world({ dropWatch: 1 });
    nav.params = { id: "op_aaaaaaaaaaaa" };
    renderWithApi(<OperationPage />, forge(w));
    expect(await screen.findByText(/Connecting to the live view again/)).toBeTruthy();
    await waitFor(() => expect(w.calls.watch).toHaveLength(2), { timeout: 3000 });
    expect(await screen.findByText("Waiting for the rollout: 1 of 2 pods ready")).toBeTruthy();
    expect(screen.queryByText(/Connecting to the live view again/)).toBeNull();
    await waitFor(
      () => {
        w.finish();
        expect(screen.getByText("Succeeded")).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("create a service", () => {
  it("asks for what the template asks for, shows each step and ends with the new service", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    // The first step is the template, the first one chosen.
    expect(((await screen.findByRole("radio", { name: /^nextjs/ })) as HTMLInputElement).checked).toBe(true);
    const steps = within(screen.getByRole("navigation", { name: "Steps" }));
    expect(steps.getAllByRole("button").map((b) => b.textContent)).toEqual(["1Template", "2Details", "3Visibility", "4Runtime", "5Review"]);
    expect(steps.getByRole("button", { name: /Template/ }).getAttribute("aria-current")).toBe("step");
    next();
    // The owner is a GitHub team, picked from the teams that exist; nobody types it.
    const owner = screen.getByLabelText("Owner") as HTMLSelectElement;
    await screen.findByRole("option", { name: "finance (Finance)" });
    expect([...owner.options].map((o) => o.value)).toEqual(["", "finance", "platform-engineering"]);
    expect(screen.queryByLabelText("Owners")).toBeNull();
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "ledger" } });
    fireEvent.change(owner, { target: { value: "finance" } });
    // A default is named, not filled in: left empty, the template applies it.
    expect((screen.getByLabelText("port") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("3000").closest("span")!.parentElement!.textContent).toContain("Left empty, it is 3000.");
    expect((screen.getByLabelText("region") as HTMLSelectElement).value).toBe("eu");
    // A default written in the template's own syntax is described, not shown raw.
    expect(document.getElementById("param-module-note")!.textContent).toBe("Left empty, the template works it out from the repo.");
    expect(document.getElementById("param-port-note")!.textContent).toBe("Port the server listens on. Left empty, it is 3000.");
    fireEvent.change(screen.getByLabelText("port"), { target: { value: "8080" } });
    click(screen.getByLabelText(/metrics/));
    // The same create as a command, flag by flag, as the form stands, beside every step.
    const command = screen.getByLabelText("The same from the terminal").textContent!;
    expect(command).toContain("forge create ledger");
    expect(command).not.toContain("--owner");
    for (const flag of ["--template nextjs", "--team finance", "--set port=8080", "--set region=eu", "--set metrics=true"]) {
      expect(command).toContain(flag);
    }
    expect(command).not.toContain("module=");
    toReview();
    // The review says what will be made before anything is.
    const review = within(screen.getByRole("list", { name: "Review" }));
    expect(review.getByText("ledger")).toBeTruthy();
    expect(review.getByText("finance")).toBeTruthy();
    expect(review.getByText("Public")).toBeTruthy();
    expect(review.getByText("port=8080")).toBeTruthy();
    expect(w.calls.create).toBeUndefined();
    click(screen.getByRole("button", { name: "Create service" }));

    expect(await screen.findByRole("heading", { name: "ledger was created" })).toBeTruthy();
    expect(screen.getByText("Fetched template nextjs@v1.3.1")).toBeTruthy();
    expect(screen.getByText("Created github.com/showmino/ledger")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open ledger" }).getAttribute("href")).toBe("/services/ledger");
    expect(w.calls.create[0]).toMatchObject({
      serviceId: "ledger",
      template: "templates/nextjs",
      ownerTeam: "finance",
      owners: [],
    });
    // Only what the writer set, plus the required choice. The module default
    // refers to the repo and must be left for the API to fill in.
    expect((w.calls.create[0] as { parameters: object }).parameters).toEqual({ port: "8080", region: "eu", metrics: "true" });
  });

  it("sends no defaults back when the writer changes nothing", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("ledger");
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "ledger was created" });
    expect((w.calls.create[0] as { parameters: object }).parameters).toEqual({ region: "eu" });
    expect((w.calls.create[0] as { runOptions?: object }).runOptions).toBeUndefined();
  });

  it("goes back without losing what was typed, and does not skip the details", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("ledger");
    fireEvent.change(screen.getByLabelText("port"), { target: { value: "8080" } });
    toReview();
    const steps = () => within(screen.getByRole("navigation", { name: "Steps" }));
    click(steps().getByRole("button", { name: /Details/ }));
    expect(steps().getByRole("button", { name: /Details/ }).getAttribute("aria-current")).toBe("step");
    expect((screen.getByLabelText("Service name") as HTMLInputElement).value).toBe("ledger");
    expect((screen.getByLabelText("port") as HTMLInputElement).value).toBe("8080");
    // A step ahead is only reached through the details being right.
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "Bad Name" } });
    click(steps().getByRole("button", { name: /Review/ }));
    expect(steps().getByRole("button", { name: /Details/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("alert").textContent).toContain("lowercase letters");
    click(screen.getByRole("button", { name: "Back" }));
    expect(steps().getByRole("button", { name: /Template/ }).getAttribute("aria-current")).toBe("step");
    expect(w.calls.create).toBeUndefined();
  });

  it("makes a private service, from any service template", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    // A file template makes no service: it has no visibility to choose.
    await pickTemplate("landing-zone");
    expect(within(screen.getByRole("navigation", { name: "Steps" })).queryByRole("button", { name: /Visibility/ })).toBeNull();
    await fillCreate("intranet", "finance", "go-grpc");
    next();
    const visibility = within(screen.getByRole("radiogroup", { name: "Visibility" }));
    expect(visibility.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["public", "public-production", "private"]);
    expect((visibility.getByRole("radio", { name: /^Public\b(?! production)/ }) as HTMLInputElement).checked).toBe(true);
    click(visibility.getByRole("radio", { name: /^Private/ }));
    const command = screen.getByLabelText("The same from the terminal").textContent!;
    expect(command).toContain("--internal");
    expect(command).not.toContain("--internal-staging");
    toReview();
    expect(within(screen.getByRole("list", { name: "Review" })).getByText("Private")).toBeTruthy();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "intranet was created" });
    expect((w.calls.create[0] as { runOptions: object }).runOptions).toMatchObject({ networkOnly: true });
  });

  it("makes a service with a public production and a private staging", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("shop", "finance", "go-grpc");
    next();
    const visibility = within(screen.getByRole("radiogroup", { name: "Visibility" }));
    click(visibility.getByRole("radio", { name: /^Public production/ }));
    expect(screen.getByLabelText("The same from the terminal").textContent).toContain("--internal-staging");
    // Back to public: no flag at all.
    click(visibility.getByRole("radio", { name: /^Public\b(?! production)/ }));
    expect(screen.getByLabelText("The same from the terminal").textContent).not.toContain("--internal");
    click(visibility.getByRole("radio", { name: /^Public production/ }));
    toReview();
    expect(within(screen.getByRole("list", { name: "Review" })).getByText("Public production")).toBeTruthy();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "shop was created" });
    const sent = (w.calls.create[0] as { runOptions: { networkOnly?: boolean } }).runOptions;
    expect(sent).toMatchObject({ stagingNetworkOnly: true });
    expect(sent.networkOnly).toBeFalsy();
  });

  it("sends the run options the template offers, and shows them as flags", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("ledger");
    next();
    next();
    // Only what nextjs offers is there.
    expect(screen.queryByText("1Password secrets")).toBeNull();
    fireEvent.change(screen.getByLabelText("Pods in production"), { target: { value: "3" } });
    click(screen.getByRole("button", { name: "Add variable" }));
    fireEvent.change(screen.getByLabelText("Variable 1 name"), { target: { value: "LOG_LEVEL" } });
    fireEvent.change(screen.getByLabelText("Variable 1 value"), { target: { value: "info" } });
    click(screen.getByRole("button", { name: "Add job" }));
    fireEvent.change(screen.getByLabelText("Job 1 name"), { target: { value: "cleanup" } });
    fireEvent.change(screen.getByLabelText("Job 1 schedule"), { target: { value: "0 3 * * *" } });
    fireEvent.change(screen.getByLabelText("Job 1 command"), { target: { value: "node cleanup.js" } });
    const command = screen.getByLabelText("The same from the terminal").textContent!;
    for (const flag of ["--replicas 3", "--env LOG_LEVEL=info", "--job 'cleanup=0 3 * * *:node cleanup.js'"]) {
      expect(command).toContain(flag);
    }
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "ledger was created" });
    expect((w.calls.create[0] as { runOptions: object }).runOptions).toMatchObject({
      replicas: 3,
      env: { LOG_LEVEL: "info" },
      jobs: [{ name: "cleanup", schedule: "0 3 * * *", command: ["node", "cleanup.js"] }],
    });
  });

  it("asks again with the same key when the connection drops, so there is one create", async () => {
    const w = world({ dropCreate: 1 });
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("ledger");
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    expect(await screen.findByRole("heading", { name: "ledger was created" })).toBeTruthy();
    const keys = (w.calls.create as { requestId: string }[]).map((c) => c.requestId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the key when Forge cannot be reached at all, and takes a new one after a definite answer", async () => {
    const w = world({ dropCreate: 2 });
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("taken");
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    expect((await screen.findByRole("alert")).textContent).toContain("it does not start a second one");
    // The writer presses again: the same create, and this time the API answers (a failure).
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByText(/already exists/);
    click(screen.getByRole("button", { name: "Create service" }));
    await waitFor(() => expect(w.calls.create).toHaveLength(4));
    const keys = (w.calls.create as { requestId: string }[]).map((c) => c.requestId);
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("starts from the template a link names, at its details", async () => {
    nav.search = "template=landing-zone";
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    expect(await screen.findByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("The same from the terminal").textContent).toContain("--template landing-zone");
    expect(screen.queryByLabelText("port")).toBeNull();
    click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("radio", { name: /^landing-zone/ }) as HTMLInputElement).checked).toBe(true);
    nav.search = "";
  });

  it("creates from a template on the template's own page, and stays there", async () => {
    nav.params = { name: "landing-zone" };
    const w = world();
    renderWithApi(<TemplateCreate />, forge(w));
    // The template is fixed: it is not a step here.
    const tpl = (await screen.findByLabelText("Template")) as HTMLInputElement;
    expect(tpl.tagName).toBe("INPUT");
    expect(tpl.readOnly).toBe(true);
    expect(tpl.value).toBe("landing-zone (v1.7.0)");
    expect(within(screen.getByRole("navigation", { name: "Steps" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["1Details", "2Review"]);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Templates" }).getAttribute("href")).toBe("/templates");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "landing-zone" }).getAttribute("href")).toBe("/templates/landing-zone");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "infosystems" } });
    await screen.findByRole("option", { name: /^finance/ });
    fireEvent.change(screen.getByLabelText("GitHub team"), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText("IP addresses needed"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Cost center"), { target: { value: "60168" } });
    toReview();
    click(screen.getByRole("button", { name: "Create pull request" }));
    expect(await screen.findByRole("heading", { name: "Pull request opened for infosystems" })).toBeTruthy();
    expect(w.calls.create[0]).toMatchObject({ template: "templates/landing-zone" });
    expect(nav.router.push).not.toHaveBeenCalled();
    nav.params = {};
  });

  it("says so when a template's create page names a template that does not exist", async () => {
    nav.params = { name: "nope" };
    renderWithApi(<TemplateCreate />, forge(world()));
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
    expect(screen.queryByRole("button", { name: /Create|Continue/ })).toBeNull();
    nav.params = {};
  });

  it("asks for the owner before going on", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await screen.findByRole("radio", { name: /^nextjs/ });
    next();
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "ledger" } });
    await screen.findByRole("option", { name: /^finance/ });
    next();
    expect(screen.getByRole("alert").textContent).toContain("Choose the team that owns the service.");
    expect(screen.getByLabelText("Service name")).toBeTruthy();
    expect(w.calls.create).toBeUndefined();
  });

  it("says why the teams cannot be listed, and still lets the owner be typed", async () => {
    const w = world({ teamsDenied: true });
    renderWithApi(<CreateService />, forge(w));
    await screen.findByRole("radio", { name: /^nextjs/ });
    next();
    expect((await screen.findByRole("alert")).textContent).toContain('grant it the organization permission "Members: read"');
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "ledger" } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: " finance " } });
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "ledger was created" });
    expect(w.calls.create[0]).toMatchObject({ serviceId: "ledger", ownerTeam: "finance" });
  });

  it("refuses a bad name before going on", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("My Service");
    next();
    expect(screen.getByRole("alert").textContent).toContain("lowercase letters");
    expect(screen.queryByRole("button", { name: "Create service" })).toBeNull();
    expect(w.calls.create).toBeUndefined();
  });

  it("says what failed and whether anything was left behind", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    await fillCreate("taken");
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    const alert = await screen.findByText(/already exists/);
    expect(alert.textContent).toContain("Nothing was left behind");
    expect(screen.getByText("Creating the repo failed")).toBeTruthy();
    // The form is still there for another try.
    expect((screen.getByRole("button", { name: "Create service" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("groups what the template requires, and checks it before going on", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    // A template's card says what it asks for.
    expect((await screen.findByRole("radio", { name: /^opentofu/ })).closest("label")!.textContent).toContain("3 required inputs, 1 optional");
    await fillCreate("infra", "finance", "opentofu");
    const inputs = within(screen.getByRole("group", { name: "opentofu inputs" }));
    expect(inputs.getAllByText("Required")).toHaveLength(2);
    // The optional ones wait behind a disclosure while there are required ones.
    const optional = screen.getByLabelText("retries").closest("details")!;
    expect(optional.open).toBe(false);
    // The command names every required input, with a placeholder until it is filled in.
    const command = () => screen.getByLabelText("The same from the terminal").textContent!;
    expect(command()).toContain("--set state_bucket=<state_bucket>");
    expect(command()).toContain("--set size=<size>");

    next();
    expect(document.getElementById("param-state_bucket-note")!.textContent).toBe("state_bucket is required.");
    expect(document.getElementById("param-size-note")!.textContent).toBe("size is required.");
    expect(screen.getByText("2 inputs need fixing")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("state_bucket"));
    // Editing a field clears its own error, not the others.
    fireEvent.change(screen.getByLabelText("state_bucket"), { target: { value: "Bad Bucket" } });
    expect(screen.getByLabelText("state_bucket").getAttribute("aria-invalid")).toBe("false");
    expect(document.getElementById("param-size-note")!.textContent).toBe("size is required.");

    fireEvent.change(screen.getByLabelText("size"), { target: { value: "ten" } });
    next();
    expect(document.getElementById("param-state_bucket-note")!.textContent).toBe("That doesn't look right: it must match ^[a-z0-9-]+$.");
    expect(document.getElementById("param-size-note")!.textContent).toBe("Enter a whole number.");
    expect(screen.getByLabelText("size").getAttribute("aria-invalid")).toBe("true");

    // A bad optional input opens the disclosure and takes the focus.
    fireEvent.change(screen.getByLabelText("state_bucket"), { target: { value: "forge-state" } });
    fireEvent.change(screen.getByLabelText("size"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("retries"), { target: { value: "x" } });
    next();
    expect(screen.getByText("One input needs fixing")).toBeTruthy();
    expect(optional.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("retries"));
    expect(w.calls.create).toBeUndefined();

    fireEvent.change(screen.getByLabelText("retries"), { target: { value: "" } });
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByRole("heading", { name: "infra was created" });
    // A required bool left unticked is false, not missing.
    expect((w.calls.create[0] as { parameters: object }).parameters).toEqual({ state_bucket: "forge-state", size: "10", public: "false" });
  });

  it("fills in a file template like a form, and ends with its pull request", async () => {
    const w = world();
    renderWithApi(<CreateService />, forge(w));
    // A file template names what it is for: no repo is made.
    expect((await screen.findByRole("radio", { name: /^landing-zone/ })).closest("label")!.textContent).toContain("Opens a pull request in showmino/landingzone");
    await fillCreate("infosystems", "finance", "landing-zone");
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("GitHub team")).toBeTruthy();
    // Inputs in the template's order, by label, the grouped ones under their heading.
    const tags = within(screen.getByRole("group", { name: "Tags" }));
    expect(tags.getByLabelText("Cost center")).toBeTruthy();
    expect((screen.getByLabelText("IP addresses needed") as HTMLInputElement).placeholder).toBe("1 - 1024");
    // A list is a row of checkboxes, its default ticked.
    const envs = within(screen.getByRole("group", { name: "Environments" }));
    expect((envs.getByLabelText("prod") as HTMLInputElement).checked).toBe(true);
    click(envs.getByLabelText("test"));
    click(envs.getByLabelText("prod"));

    fireEvent.change(screen.getByLabelText("IP addresses needed"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Cost center"), { target: { value: "60168" } });
    next();
    expect(document.getElementById("param-ipAddresses-note")!.textContent).toBe("Enter a whole number from 1 to 1024.");
    expect(w.calls.create).toBeUndefined();

    fireEvent.change(screen.getByLabelText("IP addresses needed"), { target: { value: "100" } });
    expect(screen.getByLabelText("The same from the terminal").textContent).toContain("--set environments=test");
    next();
    // A pull request has no visibility or runtime: straight to the review.
    click(screen.getByRole("button", { name: "Create pull request" }));
    expect(await screen.findByRole("heading", { name: "Pull request opened for infosystems" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /pull\/4/ }).getAttribute("href")).toBe("https://github.com/showmino/landingzone/pull/4");
    expect(screen.getByText("landingZones/Corp/lz-corp-infosystems.bicepparam")).toBeTruthy();
    expect((w.calls.create[0] as { parameters: object }).parameters).toEqual({ type: "corp", environments: "test", ipAddresses: "100", costCenter: "60168" });
  });

  it("switches the questions with the template, and tells a reader they cannot create", async () => {
    const w = world({ writer: false });
    renderWithApi(<CreateService />, forge(w));
    await screen.findByRole("radio", { name: /^nextjs/ });
    next();
    expect(screen.getByLabelText("port")).toBeTruthy();
    click(screen.getByRole("button", { name: "Back" }));
    await pickTemplate("go-grpc");
    next();
    expect(screen.queryByLabelText("port")).toBeNull();
    expect(await screen.findByText(/Only members of a team create services/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "ledger" } });
    await screen.findByRole("option", { name: /^finance/ });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "finance" } });
    expect(await screen.findByText(/You can only create services for teams you are in/)).toBeTruthy();
    toReview();
    expect(screen.queryByRole("button", { name: "Create service" })).toBeNull();
    expect(w.calls.create).toBeUndefined();
  });

  it("refuses a team the caller is not in, and lists their own teams first", async () => {
    const w = world({ caller: { teams: ["platform-engineering"] } });
    renderWithApi(<CreateService />, forge(w));
    await screen.findByRole("radio", { name: /^nextjs/ });
    next();
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "ledger" } });
    const own = await screen.findByRole("option", { name: /^platform-engineering .*your team/ });
    expect((screen.getAllByRole("option")[1] as HTMLOptionElement).value).toBe("platform-engineering");
    expect(own).toBeTruthy();
    expect(screen.queryByText(/Only members of a team create services/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "finance" } });
    expect(
      await screen.findByText("You can only create services for teams you are in. Ask platform-engineering to create it for finance."),
    ).toBeTruthy();
    toReview();
    expect(screen.queryByRole("button", { name: "Create service" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "platform-engineering" } });
    await waitFor(() => expect(screen.queryByText(/You can only create services for teams you are in/)).toBeNull());
    toReview();
    click(screen.getByRole("button", { name: "Create service" }));
    await waitFor(() => expect(w.calls.create).toHaveLength(1));
    expect(w.calls.create[0]).toMatchObject({ serviceId: "ledger", ownerTeam: "platform-engineering" });
  });
});

describe("service settings", () => {
  it("changes the team, the contacts and the lifecycle, guarded by the etag", async () => {
    const w = world();
    await openService(w);
    click(screen.getByRole("button", { name: "Service settings" }));
    expect(screen.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected")).toBe("true");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    // Nothing changed yet: nothing to save.
    expect(save.disabled).toBe(true);

    await screen.findByRole("option", { name: /^finance/ });
    fireEvent.change(screen.getByLabelText("Owning team"), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText("Contacts"), { target: { value: "ana@example.com, bo@example.com, ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Lifecycle"), { target: { value: String(Lifecycle.PRODUCTION) } });
    const cli = screen.getAllByTitle("Same action from the terminal").map((c) => c.textContent).join("\n");
    expect(cli).toContain("forge service update payments --team finance --owner ana@example.com,bo@example.com --lifecycle production");

    click(save);
    await waitFor(() => expect(w.calls.update).toHaveLength(1));
    const req = w.calls.update[0] as { service: { etag: string; ownerTeam: string; owners: string[]; lifecycle: Lifecycle }; updateMask: { paths: string[] } };
    expect(req.updateMask.paths).toEqual(["owner_team", "owners", "lifecycle"]);
    expect(req.service).toMatchObject({ etag: 'W/"3"', ownerTeam: "finance", owners: ["ana@example.com", "bo@example.com"], lifecycle: Lifecycle.PRODUCTION });
    expect(await screen.findByText("Settings saved for payments")).toBeTruthy();
  });

  it("says so when someone else changed the service first", async () => {
    const w = world({ fail: { update: new ConnectError("services/payments changed since it was read", Code.Aborted) } });
    await openService(w);
    click(screen.getByRole("button", { name: "Service settings" }));
    fireEvent.change(screen.getByLabelText("Contacts"), { target: { value: "bo@example.com" } });
    click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Someone changed this since the page loaded");
  });

  it("is not offered to a reader", async () => {
    await openService(world({ writer: false }));
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Service settings" })).toBeNull();
  });
});

describe("toasts", () => {
  it("say what was started and name the command", async () => {
    const w = world();
    await openService(w);
    click(await screen.findByRole("button", { name: "Deploy to staging" }));
    click(dialog().getByRole("button", { name: "Deploy to staging" }));
    expect(await screen.findByText("Deploying payments to staging")).toBeTruthy();
    expect(screen.getByText("forge deploy start payments --env staging --ref main")).toBeTruthy();
  });
});

describe("the environments page", () => {
  it("offers a preview's actions to its service's team only", async () => {
    renderWithApi(<Environments />, forge(world({ caller: { teams: ["platform-engineering"] } })));
    // pr-42 previews payments, which platform-engineering owns.
    expect(await screen.findByRole("button", { name: "Extend pr-42" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Destroy pr-42" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview env" })).toBeTruthy();
    cleanup();

    const w = world({ caller: { teams: ["finance"] } });
    renderWithApi(<Environments />, forge(w));
    expect(await screen.findByRole("button", { name: "Preview env" })).toBeTruthy();
    await screen.findByRole("table", { name: "Previews" });
    await permissionsAnswered(w, "");
    expect(screen.queryByRole("button", { name: "Extend pr-42" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Destroy pr-42" })).toBeNull();
  });

  it("creates a preview of the service the writer picks", async () => {
    const w = world();
    renderWithApi(<Environments />, forge(w));
    click(await screen.findByRole("button", { name: "Preview env" }));
    expect(dialog().getByRole("heading", { name: "Create a preview?" })).toBeTruthy();
    // No service picked yet: it says so instead of asking the API.
    fireEvent.change(dialog().getByLabelText("Preview name"), { target: { value: "pr-7" } });
    click(dialog().getByRole("button", { name: "Create preview" }));
    expect(dialog().getByText("Choose the service to preview.")).toBeTruthy();
    expect(w.calls.createEnv).toBeUndefined();

    await dialog().findByRole("option", { name: "ledger" });
    fireEvent.change(dialog().getByLabelText("Service"), { target: { value: "ledger" } });
    click(dialog().getByRole("button", { name: "Create preview" }));
    await waitFor(() => expect(w.calls.createEnv).toHaveLength(1));
    expect(w.calls.createEnv[0]).toMatchObject({ environmentId: "pr-7", service: "services/ledger" });
    // The new preview is followed live on the page.
    expect(await screen.findByRole("region", { name: "Operation op_dddddddddddd" })).toBeTruthy();
  });
});
