import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { ADMIN, authAs, READER, renderWithApi, signIn } from "@/test/helpers";
import Overview from "./(app)/page";

// The overview is rendered against an in-memory Forge API with a day of
// history: one deploy in flight, one failed promotion, a preview about to end.

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));

type World = {
  writer: boolean;
  quiet: boolean; // nothing running, nothing broken, nothing deployed
  auditDown: boolean;
  extended: string[];
  // Resolved by a test to let the deploy in flight end.
  land: () => void;
};
const world = (over: Partial<World> = {}): World => ({ writer: true, quiet: false, auditDown: false, extended: [], land: () => {}, ...over });

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
    router.service(AuthService, authAs(w.writer ? ADMIN : READER));
    router.service(ServiceCatalogService, {
      listServices: () => ({ services: w.quiet ? [] : [{ name: "services/payments" }, { name: "services/ledger" }, { name: "services/checkout-api" }] }),
    });
    router.service(DeployService, {
      listDeployments: () => ({
        deployments: w.quiet
          ? []
          : [
              { name: "deployments/payments/staging", service: "services/payments", env: "staging", commit: "abc1234", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED },
              { name: "deployments/checkout-api/production", service: "services/checkout-api", env: "production", commit: "5d20c9e", health: Deployment_Health.DEGRADED, sync: Deployment_SyncStatus.SYNCED, message: "1 of 3 pods is crash-looping" },
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

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  signIn();
});
afterEach(cleanup);

const stat = (label: string) => screen.getByText(label).parentElement!.querySelector("dd")!.textContent;

describe("the overview", () => {
  it("leads with the numbers of the day", async () => {
    renderWithApi(<Overview />, forge(world()));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(stat("Services in the catalog")).toBe("3"));
    // Five deploys were started today; four have ended, two of them failed.
    await waitFor(() => expect(stat("Deploys today")).toBe("5"));
    expect(stat("Finished deploys that failed")).toBe("2 of 4");
    await waitFor(() => expect(stat("Preview environments live")).toBe("2"));
    // The page names its command, and a writer can start a service from it.
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge deploy status");
    expect((await screen.findByRole("link", { name: "Create service" })).getAttribute("href")).toBe("/create");
  });

  it("shows what is in flight, live, with the stage it is at", async () => {
    const w = world();
    renderWithApi(<Overview />, forge(w));
    const flight = within(await screen.findByRole("region", { name: "In flight: Deploy payments to staging" }));
    expect(flight.getByText("In progress")).toBeTruthy();
    // The version comes from the release step; the line is at Sync.
    expect(await flight.findByText("v0.4.1-rc.2")).toBeTruthy();
    expect(await flight.findByRole("img", { name: "Deploy pipeline: running at Sync" })).toBeTruthy();
    expect(flight.getByText(/· running/).parentElement!.textContent).toBe("Sync · running");
    expect(flight.getByText("Synced, Progressing; 2 of 3 pods ready")).toBeTruthy();
    expect(flight.getByText("github:showmino/payments")).toBeTruthy();
    // The Argo CD application, and the namespace step of the log.
    expect(flight.getAllByText("payments-staging")).toHaveLength(2);
    expect(flight.getByRole("link", { name: "Watch op_9f2c4a1b0c3d" }).getAttribute("href")).toBe("/operations/op_9f2c4a1b0c3d");

    // It lands: the page reads everything again, and nothing is in flight.
    w.land();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "In flight" })).toBeNull());
  });

  it("lists what needs someone, the broken first", async () => {
    renderWithApi(<Overview />, forge(world()));
    const list = within(await screen.findByRole("list", { name: "Needs attention" }));
    const rows = list.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("checkout-api is degraded in production");
    expect(rows[0]).toContain("1 of 3 pods is crash-looping");
    // checkout-api's failed promotion was followed by a rollback that worked: only ledger's failure stands.
    expect(rows[1]).toContain("The last ledger deploy to staging failed");
    expect(rows[1]).toContain("CI test finished with failure");
    expect(rows[2]).toContain("Preview pr-388 expires in 2 h");
    expect(rows.join()).not.toContain("pr-142");
    expect(list.getByRole("link", { name: "Open checkout-api" }).getAttribute("href")).toBe("/services/checkout-api");
  });

  it("lets a writer extend a preview from the list, and a reader open it", async () => {
    const w = world();
    renderWithApi(<Overview />, forge(w));
    fireEvent.click(await screen.findByRole("button", { name: "Extend pr-388" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Extend pr-388?" })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: /Extend/ }));
    await waitFor(() => expect(w.extended).toEqual(["environments/pr-388"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    cleanup();
    renderWithApi(<Overview />, forge(world({ writer: false })));
    expect((await screen.findByRole("link", { name: "Open pr-388" })).getAttribute("href")).toBe("/services/checkout-api");
    expect(screen.queryByRole("button", { name: "Extend pr-388" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create service" })).toBeNull();
  });

  it("lists the deploys that ended, with how", async () => {
    renderWithApi(<Overview />, forge(world()));
    const list = within(await screen.findByRole("list", { name: "Recent deploys" }));
    const rows = list.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/checkout-api → production.*Rollback.*Succeeded/);
    expect(rows[1]).toMatch(/checkout-api → production.*Promotion · Argo CD did not report the application healthy in 10m0s.*Failed/);
    expect(rows[2]).toMatch(/ledger → staging.*Deploy · CI test finished with failure.*Failed/);
    // The line is red where it stopped: at the image for a CI failure, at the sync for a timeout.
    expect(list.getByRole("img", { name: "Pipeline: failed at Image" })).toBeTruthy();
    expect(list.getByRole("img", { name: "Pipeline: failed at Sync" })).toBeTruthy();
    expect(list.getAllByRole("img", { name: "Pipeline: every stage done" })).toHaveLength(2);
  });

  it("says so when nothing is running, broken or deployed", async () => {
    renderWithApi(<Overview />, forge(world({ quiet: true })));
    expect(await screen.findByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.getByText("No deploy has ended in the last 24 hours.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "In flight" })).toBeNull();
    await waitFor(() => expect(stat("Deploys today")).toBe("0"));
    expect(stat("Finished deploys that failed")).toBe("0 of 0");
  });

  it("says what could not be read, and still shows the rest", async () => {
    renderWithApi(<Overview />, forge(world({ auditDown: true })));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(stat("Services in the catalog")).toBe("3"));
    expect(stat("Deploys today")).toBe("–");
  });
});
