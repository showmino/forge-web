import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { ClusterService } from "@/gen/forge/v1/cluster_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { DocsService } from "@/gen/forge/v1/docs_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { TemplateParameter_Type, TemplateService } from "@/gen/forge/v1/template_pb";
import { ADMIN, authAs, idToken, READER, renderWithApi, signIn } from "@/test/helpers";
import { saveForgeSession } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import AuditLog from "./(app)/audit/page";
import ClusterPage from "./(app)/clusters/[name]/page";
import Clusters from "./(app)/clusters/page";
import Deployments from "./(app)/deployments/page";
import Environments from "./(app)/environments/page";
import Ownership from "./(app)/ownership/page";
import Catalog from "./(app)/services/page";
import ServicePage from "./(app)/services/[name]/page";
import TemplatePage from "./(app)/templates/[name]/page";
import Templates from "./(app)/templates/page";

// Each page is rendered against an in-memory Forge API: the same clients and
// the same messages as in the browser, without a network.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  // One router object for the whole run, as Next gives a component.
  return { params: {} as Record<string, string>, replace, router: { replace, push: vi.fn() }, pathname: "/" };
});
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
}));

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));

const payments = {
  name: "services/payments",
  displayName: "Payments",
  ownerTeam: "platform-engineering",
  owners: ["ana@example.com"],
  lifecycle: Lifecycle.PRODUCTION,
  repoUrl: "https://github.com/showmino/payments",
  updateTime: ago(12),
  createTime: ago(60 * 24 * 3),
};
const ledger = { name: "services/ledger", ownerTeam: "finance", lifecycle: Lifecycle.EXPERIMENTAL, updateTime: ago(120), dependencies: ["services/payments"] };

const deployments = [
  {
    name: "deployments/payments/staging",
    service: "services/payments",
    env: "staging",
    health: Deployment_Health.HEALTHY,
    sync: Deployment_SyncStatus.SYNCED,
    commit: "18b12326d3df2c1a11b9f664f378b579eb472aaf",
    deployedBy: "github:showmino/payments",
    deployTime: ago(12),
    url: "http://payments.staging.example.com",
  },
  {
    name: "deployments/payments/production",
    service: "services/payments",
    env: "production",
    health: Deployment_Health.DEGRADED,
    sync: Deployment_SyncStatus.SYNCED,
    commit: "57e0013aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
];

const events = [
  {
    name: "auditEvents/1",
    time: ago(5),
    action: "deploy.promote",
    kind: "outcome",
    operation: "operations/op_aaaaaaaaaaaa",
    actor: { kind: "user", email: "ana@example.com" },
    service: "services/payments",
    target: "deployments/payments/production",
    result: { code: "ok" },
  },
  {
    name: "auditEvents/2",
    time: ago(50),
    action: "deploy.rollback",
    actor: { kind: "workload", repository: "showmino/payments" },
    service: "services/payments",
    target: "deployments/payments/production",
    result: { code: "failed_precondition", message: "nothing to roll back to" },
  },
];

// The sessions a test ended on the API.
let ended: string[] = [];

function forge(router: ConnectRouter) {
  router.service(AuthService, {
    getStatus: () => ({ subject: "ana", permissions: ["services.read"] }),
    deleteSession: (req) => {
      ended.push(req.name);
      return {};
    },
  });
  router.service(ServiceCatalogService, {
    listServices: () => ({ services: [payments, ledger] }),
    getService: (req) => {
      if (req.name !== "services/payments") throw new ConnectError("no such service", Code.NotFound);
      return { service: payments };
    },
  });
  router.service(DeployService, {
    listDeployments: (req) => ({ deployments: deployments.filter((d) => !req.service || d.service === req.service) }),
    listDeployHistory: (req) => {
      if (req.name.endsWith("/production")) throw new ConnectError("no deploy yet", Code.NotFound);
      return {
        records: [
          { deployCommit: "c2", kind: "deploy", version: "v0.2.0-rc.1", commit: deployments[0].commit, actor: "github:showmino/payments", time: ago(12) },
          { deployCommit: "c1", kind: "deploy", commit: "57e0013aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "ana@example.com", time: ago(600) },
        ],
      };
    },
  });
  router.service(OperationService, {
    listOperations: () => ({
      operations: [
        { name: "operations/op_bbbbbbbbbbbb", kind: "deploy", target: "deployments/ledger/staging", creator: "bo@example.com", createTime: ago(1), events: [{ step: "resolve", message: "main is 5235eea" }] },
      ],
    }),
  });
  router.service(TeamService, {
    listTeams: () => ({ teams: [{ name: "teams/platform-engineering", displayName: "Platform Engineering" }, { name: "teams/design" }] }),
  });
  router.service(DocsService, {
    getDocSet: (req) => {
      if (req.service !== "services/payments") throw new ConnectError(`${req.service} has no docs`, Code.NotFound);
      return { docSet: { service: req.service, branch: "main", pages: [{ path: "index.md", title: "Payments" }, { path: "runbook.md", title: "Runbook" }] } };
    },
    getDocPage: (req) => ({
      page: { service: req.service, path: req.path, title: req.path === "runbook.md" ? "Runbook" : "Payments", markdown: req.path === "runbook.md" ? "# Runbook\n" : "# Payments\n\nSee the [runbook](runbook.md).\n" },
    }),
    searchDocs: (req) =>
      req.query.toLowerCase().includes("refund")
        ? { results: [{ service: "services/payments", path: "runbook.md", title: "Runbook", lines: [{ number: 5, text: "Restart the refund worker." }] }], totalSize: 1 }
        : { results: [], totalSize: 0 },
  });
  router.service(EnvironmentService, {
    listEnvironments: () => ({
      environments: [
        {
          name: "environments/pr-42",
          service: "services/payments",
          ref: "feature/refunds",
          state: Environment_State.READY,
          url: "http://pr-42.preview.example.com",
          expireTime: timestampFromDate(new Date(Date.now() + 2 * 3_600_000 + 60_000)),
        },
        { name: "environments/other", service: "services/ledger", state: Environment_State.READY },
      ],
    }),
  });
  router.service(TemplateService, {
    listTemplates: () => ({ templates: [template] }),
    getTemplate: (req) => {
      // As the server: the name must be "templates/{template}".
      if (req.name !== "templates/nextjs") throw new ConnectError(`name "${req.name}" must look like templates/{template}`, Code.InvalidArgument);
      return { template };
    },
  });
  router.service(AuditService, {
    listAuditEvents: (req) => {
      if (req.pageToken === "older") return { events: [{ ...events[1], name: "auditEvents/3", action: "service.register" }] };
      const shown = events.filter((e) => (!req.failedOnly || e.result.code !== "ok") && (!req.action || e.action === req.action));
      return { events: shown, nextPageToken: req.failedOnly || req.action ? "" : "older" };
    },
  });
}

const template = {
  name: "templates/nextjs",
  version: "v1.3.0",
  title: "Next.js web app",
  description: "Server-rendered Next.js app with CI, Dockerfile and forge.yaml",
  tags: ["typescript", "web"],
  owner: "platform",
  parameters: [{ name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000", description: "Port the server listens on" }],
};

const row = (text: string) => screen.getByText(text).closest("tr")!;

beforeEach(() => {
  ended = [];
  sessionStorage.clear();
  localStorage.clear();
  nav.params = {};
  nav.pathname = "/";
  nav.replace.mockClear();
  signIn();
});
afterEach(cleanup);

describe("the catalog", () => {
  it("lists every service with how staging and production are doing", async () => {
    renderWithApi(<Catalog />, forge);
    const name = await screen.findByRole("link", { name: "payments" });
    expect(name.getAttribute("href")).toBe("/services/payments");
    await waitFor(() => expect(within(row("payments")).getByText("Healthy")).toBeTruthy());
    expect(within(row("payments")).getByText("Degraded")).toBeTruthy();
    expect(within(row("payments")).getByText("12 min ago")).toBeTruthy();
    // A service that was never deployed says so in both columns.
    expect(within(row("ledger")).getAllByText("Not deployed")).toHaveLength(2);
  });

  it("filters by name or team", async () => {
    renderWithApi(<Catalog />, forge);
    await screen.findByRole("link", { name: "payments" });
    fireEvent.change(screen.getByPlaceholderText("Name or team"), { target: { value: "finance" } });
    expect(screen.queryByRole("link", { name: "payments" })).toBeNull();
    expect(screen.getByRole("link", { name: "ledger" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Name or team"), { target: { value: "zzz" } });
    expect(screen.getByText(/No services match/)).toBeTruthy();
  });

  it("filters by team with a chip, and names the command that does the same", async () => {
    renderWithApi(<Catalog />, forge);
    await screen.findByRole("link", { name: "payments" });
    const cli = () => screen.getByTitle("Same action from the terminal").textContent;
    expect(cli()).toContain("forge service list");
    fireEvent.click(screen.getByRole("button", { name: /^finance/ }));
    expect(screen.queryByRole("link", { name: "payments" })).toBeNull();
    expect(screen.getByRole("link", { name: "ledger" })).toBeTruthy();
    expect(cli()).toContain("forge service list --team finance");
    expect(screen.getByText("1 service shown.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^All teams/ }));
    expect(screen.getByRole("link", { name: "payments" })).toBeTruthy();
  });

  it("says how to make the first service when there is none", async () => {
    renderWithApi(<Catalog />, (router) => {
      router.service(ServiceCatalogService, { listServices: () => ({}) });
      router.service(DeployService, { listDeployments: () => ({}) });
    });
    expect(await screen.findByText(/No services yet/)).toBeTruthy();
  });

  it("says what to do when the reader has no access", async () => {
    renderWithApi(<Catalog />, (router) => {
      router.service(ServiceCatalogService, {
        listServices: () => {
          throw new ConnectError("nope", Code.PermissionDenied);
        },
      });
      router.service(DeployService, { listDeployments: () => ({}) });
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Ask platform-engineering for access");
  });
});

describe("a service", () => {
  it("shows its owners, both environments, its previews and its history", async () => {
    nav.params = { name: "payments" };
    renderWithApi(<ServicePage />, forge);
    // The name is the title, set as it is typed; the team is in the crumbs.
    expect(await screen.findByRole("heading", { name: "payments" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("platform-engineering")).toBeTruthy();
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge service get payments");
    expect(screen.getByText("ana@example.com", { selector: "dd" })).toBeTruthy();

    const staging = within(await screen.findByRole("table", { name: "Deployments" }));
    expect(within(staging.getByText("staging").closest("tr")!).getByText("18b1232")).toBeTruthy();
    expect(within(staging.getByText("production").closest("tr")!).getByText("Degraded")).toBeTruthy();

    // Only this service's previews, with the branch and when it expires.
    const previews = within(await screen.findByRole("list", { name: "Previews" }));
    const preview = previews.getByText("pr-42").closest("li")!;
    expect(preview.textContent).toContain("feature/refunds");
    expect(preview.textContent).toContain("expires in 2 h");
    expect(within(preview).getByText("Ready")).toBeTruthy();
    expect(previews.queryByText("other")).toBeNull();

    const history = within(await screen.findByRole("list", { name: "Recent activity" }));
    expect(within(history.getByText("deploy.promote").closest("li")!).getByText("OK")).toBeTruthy();
    // A CI run is named by its repository; a failure shows its reason on hover.
    const failed = history.getByText("deploy.rollback").closest("li")!;
    expect(failed.textContent).toContain("showmino/payments");
    expect(within(failed).getByText("Failed").getAttribute("title")).toBe("nothing to roll back to");
    expect(screen.getByRole("link", { name: "All activity of payments" }).getAttribute("href")).toBe("/audit?service=payments");
  });

  it("says so when the service does not exist", async () => {
    nav.params = { name: "nope" };
    renderWithApi(<ServicePage />, forge);
    expect((await screen.findByRole("alert")).textContent).toContain("does not exist");
  });

  it("shows its deploy history and its dependencies in tabs", async () => {
    nav.params = { name: "payments" };
    renderWithApi(<ServicePage />, forge);
    fireEvent.click(await screen.findByRole("tab", { name: "Deployments" }));
    const staging = within(await screen.findByRole("table", { name: "History of staging" }));
    expect(within(staging.getByText("v0.2.0-rc.1").closest("tr")!).getByText("runs now")).toBeTruthy();
    expect(staging.getByText("57e0013")).toBeTruthy();
    // Never deployed to production: no error, just nothing.
    expect(await screen.findByText("Nothing was deployed to production yet.")).toBeTruthy();

    // The arrow keys move between tabs.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Deployments" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /^Dependencies/ }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("payments depends on no other service in the catalog.")).toBeTruthy();
    expect((await screen.findByRole("link", { name: /ledger/ })).getAttribute("href")).toBe("/services/ledger");
  });

  it("reads its docs in a tab, page by page", async () => {
    nav.params = { name: "payments" };
    renderWithApi(<ServicePage />, forge);
    fireEvent.click(await screen.findByRole("tab", { name: "Docs" }));
    const start = within(await screen.findByRole("article", { name: "Payments" }));
    fireEvent.click(start.getByRole("link", { name: "runbook" }));
    expect(await screen.findByRole("article", { name: "Runbook" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Docs" }).getAttribute("href")).toBe("/docs/payments/runbook.md");
  });

  it("has no Docs tab when the service has no docs", async () => {
    nav.params = { name: "payments" };
    renderWithApi(<ServicePage />, (router) => {
      forge(router);
      router.service(DocsService, {
        getDocSet: () => {
          throw new ConnectError("no docs", Code.NotFound);
        },
      });
    });
    await screen.findByRole("tab", { name: "Overview" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Docs" })).toBeNull());
  });
});

describe("deployments", () => {
  it("lists the running ones and the ones that ended, and filters them", async () => {
    renderWithApi(<Deployments />, forge);
    const table = within(await screen.findByRole("table", { name: "Deployments" }));
    const running = (await table.findByRole("link", { name: "ledger" })).closest("tr")!;
    expect(within(running).getByText("5235eea")).toBeTruthy();
    expect(within(running).getByRole("link", { name: "Watch op_bbbbbbbbbbbb" }).getAttribute("href")).toBe("/operations/op_bbbbbbbbbbbb");
    const promoted = table.getByRole("link", { name: "payments" }).closest("tr")!;
    expect(within(promoted).getByText("Succeeded")).toBeTruthy();
    expect(within(promoted).getByText("ana@example.com")).toBeTruthy();
    // A refused rollback started nothing: it is in the audit log, not here.
    expect(table.getAllByRole("row")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /^Failed/ }));
    expect(screen.getByText("No deployments match this filter.")).toBeTruthy();
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge audit list --since 7d --failed");
  });
});

describe("environments", () => {
  it("sums up staging and production and lists every preview", async () => {
    renderWithApi(<Environments />, forge);
    const staging = within(await screen.findByRole("region", { name: "staging" }));
    expect(staging.getByText("Healthy")).toBeTruthy();
    const production = within(screen.getByRole("region", { name: "production" }));
    expect(production.getByText("Degraded")).toBeTruthy();
    expect(production.getByText(/Needs a look/).textContent).toContain("payments");

    const previews = within(await screen.findByRole("table", { name: "Previews" }));
    const pr42 = previews.getByText("pr-42").closest("tr")!;
    expect(within(pr42).getByText("ends in 2 h")).toBeTruthy();
    expect(within(pr42).getByText("Ready")).toBeTruthy();
    expect(previews.getByText("other")).toBeTruthy();
    // A reader sees no actions.
    expect(previews.queryByRole("button", { name: "Extend pr-42" })).toBeNull();
  });
});

describe("ownership", () => {
  it("joins the services with the organization's teams and names what has no owner", async () => {
    renderWithApi(<Ownership />, forge);
    const needs = within(await screen.findByRole("list", { name: "Needs an owner" }));
    expect(needs.getByRole("link", { name: "ledger" })).toBeTruthy();
    expect(needs.getByText(/is not a team of the organization/).textContent).toContain("finance");
    const teams = within(screen.getByRole("table", { name: "Teams" }));
    expect(within(teams.getByText("platform-engineering").closest("tr")!).getByRole("link", { name: "payments" })).toBeTruthy();
    expect(within(teams.getByText("finance").closest("tr")!).getByText("Not on GitHub")).toBeTruthy();
    expect(within(teams.getByText("design").closest("tr")!).getByText("No services yet")).toBeTruthy();
  });
});

describe("clusters", () => {
  const GiB = BigInt(1) << BigInt(30);
  const capacity = (cpu: number, cpuUsed: number, mem: number, memUsed: number, pods: number, disk = 0, diskUsed = 0) => ({
    cpuMillis: BigInt(cpu),
    cpuUsedMillis: BigInt(cpuUsed),
    memoryBytes: BigInt(mem) * GiB,
    memoryUsedBytes: BigInt(memUsed) * GiB,
    pods,
    podsMax: 110,
    diskBytes: BigInt(disk) * GiB,
    diskUsedBytes: BigInt(diskUsed) * GiB,
  });
  // The shapes the live API sends (forge-api v0.25.0).
  const cluster = (metricsAvailable = true) => ({
    name: "clusters/default",
    kubernetesVersion: "v1.37.0+k3s1",
    createTime: ago(60 * 24 * 184),
    grafanaUrl: "https://grafana.example.com",
    metricsAvailable,
    storageAvailable: metricsAvailable,
    totals: { ...capacity(12000, metricsAvailable ? 3500 : 0, 24, metricsAvailable ? 10 : 0, 3, 300, 95), podsMax: 220 },
    nodes: [
      { name: "srv-cron", roles: ["worker"], condition: "Ready", schedulable: true, kubeletVersion: "v1.37.0+k3s1", capacity: capacity(8000, 2500, 16, 4, 2, 200, 20) },
      { name: "srv-kube", roles: ["control-plane", "etcd"], condition: "Ready", schedulable: true, kubeletVersion: "v1.37.0+k3s1", capacity: capacity(4000, 1000, 8, 6, 1, 100, 75) },
      { name: "srv-lab", roles: ["worker"], condition: "MemoryPressure", schedulable: false, kubeletVersion: "v1.37.0+k3s1", capacity: capacity(4000, 500, 8, 7, 1, 50, 45) },
    ],
    volumes: metricsAvailable
      ? [
          { namespace: "payments-production", claim: "data", capacityBytes: BigInt(10) * GiB, usedBytes: BigInt(9) * GiB, service: "services/payments", environment: "production" },
          { namespace: "monitoring", claim: "prometheus-db", capacityBytes: BigInt(50) * GiB, usedBytes: BigInt(20) * GiB },
        ]
      : [],
  });
  const clusters = (metrics = true) => (router: ConnectRouter) => {
    forge(router);
    router.service(ClusterService, {
      listClusters: () => ({ clusters: [cluster(metrics)] }),
      getCluster: (req) => {
        if (req.name !== "clusters/default") throw new ConnectError("there is no cluster", Code.NotFound);
        return { cluster: cluster(metrics) };
      },
    });
  };

  it("lists the cluster with its worst problem and how full it is", async () => {
    renderWithApi(<Clusters />, clusters());
    const c = within((await screen.findByRole("link", { name: "default" })).closest("tr")!);
    expect(screen.getByRole("link", { name: "default" }).getAttribute("href")).toBe("/clusters/default");
    expect(c.getByText("Memory pressure on 1 node")).toBeTruthy();
    expect(c.getByRole("img", { name: "CPU 29% used" })).toBeTruthy();
    expect(c.getByRole("img", { name: "Memory 42% used" })).toBeTruthy();
    expect(c.getByRole("img", { name: "Storage 32% used" })).toBeTruthy();
    expect(c.getByText("v1.37.0+k3s1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Grafana/ }).getAttribute("href")).toBe("https://grafana.example.com");
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge cluster list");
  });

  it("shows every node of one cluster", async () => {
    nav.params = { name: "default" };
    renderWithApi(<ClusterPage />, clusters());
    expect(await screen.findByRole("heading", { name: "default" })).toBeTruthy();
    const lab = within(row("srv-lab"));
    expect(lab.getByText("Memory Pressure")).toBeTruthy();
    expect(lab.getByText("cordoned")).toBeTruthy();
    expect(lab.getByRole("img", { name: "srv-lab memory 88% used" })).toBeTruthy();
    expect(within(row("srv-kube")).getByText(/control-plane, etcd · 4 cores · 8.0 GiB/)).toBeTruthy();
    expect(within(row("srv-cron")).getByText("2/110")).toBeTruthy();
    expect(screen.getByText("of 220 that fit")).toBeTruthy();
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge cluster get default");
    expect(lab.getByRole("img", { name: "srv-lab disk 90% used" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Disk 32% used" })).toBeTruthy();
    // Volumes, fullest first, tied to their service and environment.
    const vols = within(screen.getByRole("table", { name: "Volumes" }));
    const data = within(vols.getByText("data").closest("tr")!);
    expect(data.getByRole("link", { name: "payments" }).getAttribute("href")).toBe("/services/payments");
    expect(data.getByText("production")).toBeTruthy();
    expect(data.getByRole("img", { name: "payments-production/data 90% used" })).toBeTruthy();
    expect(within(vols.getByText("prometheus-db").closest("tr")!).getByText("–")).toBeTruthy();
  });

  it("shows the nodes without usage figures when metrics-server does not answer", async () => {
    nav.params = { name: "default" };
    renderWithApi(<ClusterPage />, clusters(false));
    expect(await screen.findByText(/metrics-server did not answer/)).toBeTruthy();
    expect(screen.queryAllByRole("img", { name: /% used/ })).toEqual([]);
    expect(within(row("srv-cron")).getByText("8 cores")).toBeTruthy();
  });

  it("says what is wrong for someone who is not an admin", async () => {
    renderWithApi(<Clusters />, (router) => {
      forge(router);
      router.service(ClusterService, {
        listClusters: () => {
          throw new ConnectError("bo may not cluster.read: only an admin may", Code.PermissionDenied);
        },
      });
    });
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to this");
  });
});

describe("templates", () => {
  it("lists the templates", async () => {
    renderWithApi(<Templates />, forge);
    expect((await screen.findByRole("link", { name: "nextjs" })).getAttribute("href")).toBe("/templates/nextjs");
    const card = within(screen.getByRole("link", { name: "nextjs" }).closest("li")!);
    expect(card.getByText("Next.js web app")).toBeTruthy();
    expect(card.getByText(/v1\.3\.0 · platform/)).toBeTruthy();
    expect(card.getByText("typescript")).toBeTruthy();
    expect(card.getByText("No required inputs")).toBeTruthy();
    // A reader cannot create, so the card offers them nothing to press.
    expect(card.queryByRole("link", { name: /Use template/ })).toBeNull();
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge template list");
  });

  it("shows what one template asks for", async () => {
    nav.params = { name: "nextjs" };
    renderWithApi(<TemplatePage />, forge);
    expect(await screen.findByRole("heading", { name: "nextjs" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Next.js web app")).toBeTruthy();
    const port = within(row("port"));
    expect(port.getByText("Number")).toBeTruthy();
    expect(port.getByText("3000")).toBeTruthy();
    expect(port.getByText("Port the server listens on")).toBeTruthy();
  });
});

describe("the audit log", () => {
  it("lists events, loads older ones and filters", async () => {
    renderWithApi(<AuditLog />, forge);
    expect(await screen.findByText("deploy.promote")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "payments" })[0].getAttribute("href")).toBe("/services/payments");

    fireEvent.click(screen.getByRole("button", { name: "Show older events" }));
    expect(await screen.findByText("service.register")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show older events" })).toBeNull());

    fireEvent.click(screen.getByLabelText("Failed only"));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("deploy.rollback")).toBeTruthy();
    expect(screen.queryByText("deploy.promote")).toBeNull();

    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "no.such" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No event matches these filters.")).toBeTruthy();
  });
});

describe("the frame around every page", () => {
  it("sends a reader without a login to the login page, and back afterwards", async () => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/services/payments");
    renderWithApi(<AppShell>secret</AppShell>, forge);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login?return=%2Fservices%2Fpayments"));
    expect(screen.queryByText("secret")).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("shows who is logged in, and their role, and signs out", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge);
    expect(await screen.findByText("content")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Reader")).toBeTruthy();
    // The rail counts the services beside the link, and marks where the reader is.
    expect((await screen.findByRole("link", { name: "Services 2" })).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(sessionStorage.getItem("forge.session")).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/login");
  });

  it("ends a Forge session on the API when signing out, and follows a sign-out in another tab", async () => {
    saveForgeSession("fgs_abc", Date.now() + 7 * 24 * 3_600_000, idToken({ sub: "ana", email: "ana@example.com", exp: Date.now() / 1000 + 3600 }));
    renderWithApi(<AppShell>content</AppShell>, forge);
    expect(await screen.findByText("content")).toBeTruthy();
    // Another tab signs out: this one stops showing the page.
    localStorage.removeItem("forge.session");
    sessionStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: "forge.session" }));
    await waitFor(() => expect(screen.queryByText("content")).toBeNull());
    expect(ended).toEqual([]);

    cleanup();
    saveForgeSession("fgs_abc", Date.now() + 7 * 24 * 3_600_000, idToken({ sub: "ana", email: "ana@example.com", exp: Date.now() / 1000 + 3600 }));
    renderWithApi(<AppShell>content</AppShell>, forge);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(ended).toEqual(["sessions/current"]));
    expect(localStorage.getItem("forge.session")).toBeNull();
  });

  it("starts with the rail as icons, and remembers when it is opened", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge);
    const toggle = await screen.findByRole("button", { name: "Expand sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const main = screen.getByRole("main");
    expect(main.classList.contains("w-full")).toBe(true);
    expect(main.className).not.toMatch(/max-w-/);
    // Collapsed, a link keeps its name for screen readers and shows it on hover.
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview.getAttribute("title")).toBe("Overview");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded")).toBe("true");
    expect(main.className).not.toMatch(/max-w-/);
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("title")).toBeNull();
    expect(localStorage.getItem("forge.rail")).toBe("full");

    cleanup();
    renderWithApi(<AppShell>content</AppShell>, forge);
    expect(await screen.findByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
    localStorage.removeItem("forge.rail");
  });

  it.each([
    ["an admin", ADMIN, "Admin"],
    ["a member of a team", { teams: ["payments"] }, "Team"],
    ["anyone else", READER, "Reader"],
  ] as const)("names %s in the rail", async (_, caller, word) => {
    renderWithApi(<AppShell>content</AppShell>, (router) => {
      router.service(AuthService, authAs(caller));
    });
    expect(await screen.findByText(word)).toBeTruthy();
    // The rail starts as icons: the avatar says it on hover.
    expect(screen.getByTitle(`ana@example.com · ${word}`)).toBeTruthy();
    // Only an admin sees the clusters.
    expect(screen.queryByRole("link", { name: "Clusters" }) !== null).toBe(word === "Admin");
  });

  it("finds pages of the docs from the palette by what they say", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge);
    await screen.findByText("content");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Jump to" });
    fireEvent.change(input, { target: { value: "refund worker" } });
    const page = await screen.findByRole("option", { name: /Runbook/ });
    expect(page.textContent).toContain("Docs · payments");
    expect([...page.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["refund", "worker"]);
    // No place is named so: the docs come first, then the way to every result.
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Runbook"), expect.stringContaining("Search all docs for “refund worker”")]);
    expect(page.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.router.push).toHaveBeenCalledWith("/docs?q=refund%20worker");

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "refund" } });
    fireEvent.click(await screen.findByRole("option", { name: /Runbook/ }));
    expect(nav.router.push).toHaveBeenCalledWith("/docs/payments/runbook.md");

    // Words no page holds: it says so, and the places still show.
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "payments" } });
    expect(await screen.findByText(/no page holds all of the words/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /^payments/ })).toBeTruthy();
  });

  it("jumps to a service from the palette", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge);
    await screen.findByText("content");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Jump to" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "led" } });
    const option = await screen.findByRole("option", { name: /^ledger/ });
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.router.push).toHaveBeenCalledWith("/services/ledger");
    expect(screen.queryByRole("combobox")).toBeNull();

    // Templates are places too.
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox", { name: "Jump to" }), { target: { value: "next" } });
    expect((await screen.findByRole("option", { name: /^nextjs/ })).textContent).toContain("Template · Next.js web app");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    // The button in the top bar opens it too, and Escape closes it.
    fireEvent.click(screen.getByRole("button", { name: /Search or jump to/ }));
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

// The app is scaled with CSS zoom, which also scales viewport units: a 100vh
// box paints taller than the screen, so the rail could not stick and every
// page had a scrollbar it did not need. Heights that mean "one screen" go
// through --vh, which divides the zoom out again.
describe("the zoomed viewport", () => {
  it("defines the zoom and a screen height that allows for it", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/--zoom:\s*[\d.]+/);
    expect(css).toMatch(/--vh:\s*calc\(100vh\s*\/\s*var\(--zoom\)\)/);
    // The zoom is set from the variable, so there is one place to change it.
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("[zoom:var(--zoom)]");
  });

  it("asks for a screen through --vh, never a raw viewport unit", () => {
    for (const file of ["app/layout.tsx", "components/app-shell.tsx", "components/command-palette.tsx", "app/login/page.tsx", "app/auth/callback/page.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(`${file}: ${src.match(/\b(min-)?h-screen\b|\b\d+vh\b/) ?? "none"}`).toBe(`${file}: none`);
    }
  });
});
