import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
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
