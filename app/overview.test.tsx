import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { ClusterService } from "@/gen/forge/v1/cluster_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { ADMIN, authAs, type Caller, READER, renderWithApi, signIn } from "@/test/helpers";
import Home from "./(app)/page";

// The home page is rendered against an in-memory Forge API with a day of
// history: one deploy in flight, one failed promotion, a preview about to end,
// and one of two clusters short of memory.

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));

type World = {
  writer: boolean;
  // Who calls, when not an admin (writer) or a reader.
  caller?: Caller;
  quiet: boolean; // nothing running, nothing broken, nothing deployed
  auditDown: boolean;
  clustersDown: boolean;
  extended: string[];
  // More healthy services in staging, for a board with many.
  many?: number;
  // Resolved by a test to let the deploy in flight end.
  land: () => void;
};
const world = (over: Partial<World> = {}): World => ({ writer: true, quiet: false, auditDown: false, clustersDown: false, extended: [], land: () => {}, ...over });

const outcome = (id: number, minutes: number, action: string, service: string, env: string, code: string, message = "") => ({
  name: `auditEvents/${id}`,
  time: ago(minutes),
  kind: "outcome",
  action,
  service: `services/${service}`,
  target: `deployments/${service}/${env}`,
  result: { code, message },
});
const request = (id: number, minutes: number, action: string, service: string, env: string) => ({ ...outcome(id, minutes, action, service, env, "ok"), kind: "request" });

function forge(w: World) {
  const running = { name: "operations/op_9f2c4a1b0c3d", kind: "deploy", target: "deployments/payments/staging", creator: "github:showmino/payments", createTime: ago(4) };
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller ?? (w.writer ? ADMIN : READER)));
    router.service(ServiceCatalogService, {
      listServices: () => ({
        services: w.quiet
          ? []
          : [
              { name: "services/payments", ownerTeam: "payments" },
              { name: "services/ledger", ownerTeam: "finance" },
              { name: "services/checkout-api", ownerTeam: "commerce" },
            ],
      }),
    });
    router.service(DeployService, {
      listDeployments: () => ({
        deployments: w.quiet
          ? []
          : [
              { name: "deployments/payments/staging", service: "services/payments", env: "staging", commit: "abc1234", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, deployTime: ago(60) },
              { name: "deployments/checkout-api/production", service: "services/checkout-api", env: "production", commit: "5d20c9e", health: Deployment_Health.DEGRADED, sync: Deployment_SyncStatus.SYNCED, message: "1 of 3 pods is crash-looping", deployTime: ago(31) },
              { name: "deployments/ledger/production", service: "services/ledger", env: "production", commit: "0f6a2d4", version: "v1.2.0", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, deployTime: ago(180) },
              ...Array.from({ length: w.many ?? 0 }, (_, i) => ({
                name: `deployments/svc-${i}/staging`,
                service: `services/svc-${i}`,
                env: "staging",
                commit: "1a2b3c4",
                health: Deployment_Health.HEALTHY,
                sync: Deployment_SyncStatus.SYNCED,
                deployTime: ago(600 + i),
              })),
            ],
      }),
    });
    router.service(EnvironmentService, {
      listEnvironments: () => ({
        environments: w.quiet
          ? []
          : [
              { name: "environments/pr-388", service: "services/checkout-api", creator: "jonas.weber@example.com", state: Environment_State.READY, expireTime: timestampFromDate(new Date(Date.now() + 2 * 3_600_000 + 60_000)) },
              { name: "environments/pr-142", service: "services/payments", creator: "ana@example.com", state: Environment_State.READY, expireTime: timestampFromDate(new Date(Date.now() + 30 * 3_600_000)) },
            ],
      }),
      extendEnvironment: (req) => {
        w.extended.push(req.name);
        return {};
      },
    });
    router.service(OperationService, {
      listOperations: (req) => ({ operations: w.quiet || !req.running ? [] : [running] }),
      async *watchOperation() {
        yield { kind: { case: "event" as const, value: { time: ago(3), step: "resolve", message: "main is 9c1e2fa" } } };
        yield { kind: { case: "event" as const, value: { time: ago(3), step: "image", message: "found ghcr.io/showmino/payments:9c1e2fa" } } };
        yield { kind: { case: "event" as const, value: { time: ago(2), step: "release", message: "release candidate v0.4.1-rc.2 for 9c1e2fa" } } };
        yield { kind: { case: "event" as const, value: { time: ago(2), step: "commit", message: "forge-deploys 21c0971: ghcr.io/showmino/payments:9c1e2fa" } } };
        yield { kind: { case: "event" as const, value: { time: ago(1), step: "namespace", message: "payments-staging" } } };
        yield { kind: { case: "event" as const, value: { time: ago(0), step: "sync", message: "Synced, Progressing; 2 of 3 pods ready" } } };
        await new Promise<void>((resolve) => (w.land = resolve));
        w.quiet = true; // nothing is running any more
        yield { kind: { case: "operation" as const, value: { ...running, done: true, endTime: ago(0) } } };
      },
    });
    router.service(ClusterService, {
      listClusters: () => {
        if (w.clustersDown) throw new ConnectError("Kubernetes is away", Code.Unavailable);
        return {
          clusters: [
            { name: "clusters/prod-eu-1", nodes: [{ name: "w-1", condition: "Ready" }] },
            { name: "clusters/prod-us-1", nodes: [{ name: "w-1", condition: "MemoryPressure" }, { name: "w-2", condition: "Ready" }] },
          ],
        };
      },
    });
    router.service(AuditService, {
      listAuditEvents: (req) => {
        if (w.auditDown) throw new ConnectError("the database is away", Code.Unavailable);
        // As the API: the caller asks for the last 24 hours.
        if (!req.since) throw new ConnectError("the overview must ask for a window", Code.InvalidArgument);
        return {
          events: w.quiet
            ? []
            : [
                request(9, 4, "deploy.start", "payments", "staging"),
                outcome(8, 31, "deploy.rollback", "checkout-api", "production", "ok"),
                request(7, 32, "deploy.rollback", "checkout-api", "production"),
                outcome(6, 38, "deploy.promote", "checkout-api", "production", "failed", "sync_timeout: Argo CD did not report the application healthy in 10m0s"),
                request(5, 45, "deploy.promote", "checkout-api", "production"),
                outcome(4, 50, "deploy.start", "ledger", "staging", "failed", "ci_failed: CI test finished with failure"),
                request(3, 52, "deploy.start", "ledger", "staging"),
                outcome(2, 60, "deploy.start", "payments", "staging", "ok"),
                request(1, 62, "deploy.start", "payments", "staging"),
              ],
        };
      },
    });
  };
}

// Only Date is frozen (not timers): the fixtures below go back up to 62
// minutes in ago(), which crosses midnight -- and so fails near it -- if
// Date.now() is real. A fixed afternoon keeps every fixture on the same day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 15, 0, 0));
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the home page", () => {

  const stat = (label: string) => screen.getByText(label, { selector: "div" }).parentElement!.textContent;

  it("says what Forge is for, with the actions the role allows", async () => {
    renderWithApi(<Home />, forge(world()));
    expect(screen.getByRole("heading", { level: 1, name: "Internal Developer Platform" })).toBeTruthy();
    expect((await screen.findByRole("link", { name: "Create a service" })).getAttribute("href")).toBe("/create");
    expect(screen.getByRole("link", { name: "Deploy a change" })).toBeTruthy();
    expect(screen.getByText(/As an/).textContent).toContain("admin");

    cleanup();
    renderWithApi(<Home />, forge(world({ writer: false })));
    expect(await screen.findByRole("link", { name: "Browse templates" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/As a/).textContent).toContain("reader"));
    expect(screen.queryByRole("link", { name: "Create a service" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Deploy a change" })).toBeNull();
  });

  it("leads with four numbers", async () => {
    renderWithApi(<Home />, forge(world()));
    await waitFor(() => expect(stat("Services")).toContain("3"));
    // Five deploys asked for today; of the four that ended, two failed.
    await waitFor(() => expect(stat("Deploys today")).toContain("5"));
    expect(stat("Deploys today")).toContain("50% success");
    // checkout-api is degraded, ledger's deploy failed, and pr-388 ends soon.
    await waitFor(() => expect(stat("Need a decision")).toContain("3"));
    expect(stat("Production")).toContain("1 unhealthy");
  });

  it("lists the services that need a look first, and what needs the caller", async () => {
    renderWithApi(<Home />, forge(world()));
    const table = within(await screen.findByRole("table", { name: "Services" }));
    await waitFor(() => expect(table.getAllByRole("link").map((a) => a.textContent)).toEqual(["checkout-api", "ledger", "payments"]));
    expect(within(table.getByText("checkout-api").closest("tr")!).getByText("Degraded")).toBeTruthy();

    const needs = within(await screen.findByRole("list", { name: "Needs attention" }));
    const lines = needs.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toContain("checkout-api is degraded in production");
    expect(lines.some((l) => l?.includes("The last ledger deploy to staging failed"))).toBe(true);
    expect(lines.some((l) => l?.includes("Preview pr-388 expires"))).toBe(true);
  });

  it("shows a team member their team's services and what is wrong with them", async () => {
    renderWithApi(<Home />, forge(world({ caller: { teams: ["commerce"] } })));
    expect(await screen.findByRole("heading", { name: "Your services" })).toBeTruthy();
    const table = within(await screen.findByRole("table", { name: "Services" }));
    await waitFor(() => expect(table.getAllByRole("link").map((a) => a.textContent)).toEqual(["checkout-api"]));
    await waitFor(() => expect(stat("Your team's services")).toContain("of 3"));
    const lines = within(await screen.findByRole("list", { name: "Needs attention" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    // ledger is another team's; the preview is of checkout-api, theirs.
    expect(lines.some((l) => l?.includes("ledger"))).toBe(false);
    expect(lines.some((l) => l?.includes("pr-388"))).toBe(true);
  });

  it("lets a writer extend a preview from the list, and a reader open it", async () => {
    const w = world();
    renderWithApi(<Home />, forge(w));
    fireEvent.click(await screen.findByRole("button", { name: "Extend pr-388" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Extend pr-388?" })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: /Extend/ }));
    await waitFor(() => expect(w.extended).toEqual(["environments/pr-388"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    cleanup();
    renderWithApi(<Home />, forge(world({ writer: false })));
    expect((await screen.findByRole("link", { name: "Open pr-388" })).getAttribute("href")).toBe("/services/checkout-api");
    expect(screen.queryByRole("button", { name: "Extend pr-388" })).toBeNull();
    expect(screen.getByText(/Their owners are on it/)).toBeTruthy();
  });

  it("lists the deploys that ended, with how", async () => {
    renderWithApi(<Home />, forge(world()));
    const list = within(await screen.findByRole("list", { name: "Recent deploys" }));
    const rows = list.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/Rolled back checkout-api → production/);
    expect(rows[1]).toMatch(/Failed checkout-api → production/);
    expect(rows[2]).toMatch(/Failed ledger → staging/);
    expect(rows[3]).toMatch(/Deployed payments → staging/);
  });

  it("says how the platform is doing", async () => {
    renderWithApi(<Home />, forge(world()));
    const lines = within(await screen.findByRole("list", { name: "Platform status" }));
    const text = (label: string) => lines.getByText(label).closest("a")!.textContent;
    await waitFor(() => expect(text("Production")).toContain("1 unhealthy"));
    expect(text("Staging")).toContain("Operational");
    await waitFor(() => expect(text("Previews")).toContain("2 live, 1 ending soon"));
    await waitFor(() => expect(text("Deploy pipeline")).toContain("1 running"));
    await waitFor(() => expect(text("Clusters")).toContain("1 needs a look"));
  });

  it("shows the way to production when nothing needs the caller", async () => {
    renderWithApi(<Home />, forge(world({ quiet: true })));
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeTruthy();
    const steps = within(screen.getByRole("list", { name: "Get started" }));
    expect(steps.getByText("Sign in to Forge").textContent).toContain("(done)");
    // An admin is on the way to production; the list follows once their role is known.
    expect(await screen.findByRole("link", { name: "Create your first service" })).toBeTruthy();
    await waitFor(() => expect(stat("Need a decision")).toContain("All clear"));
    expect(await screen.findByText("No deploy has ended in the last 24 hours.")).toBeTruthy();
  });

  it("says what could not be read, and still shows the rest", async () => {
    renderWithApi(<Home />, forge(world({ auditDown: true, clustersDown: true })));
    expect((await screen.findByRole("alert")).textContent).toContain("The Forge API cannot be reached");
    const lines = within(await screen.findByRole("list", { name: "Platform status" }));
    await waitFor(() => expect(lines.getByText("Production").closest("a")!.textContent).toContain("1 unhealthy"));
    expect(lines.queryByText("Clusters")).toBeNull();
    expect(await screen.findByRole("table", { name: "Services" })).toBeTruthy();
  });
});
