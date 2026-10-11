import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { TemplateParameter_Type, TemplateService } from "@/gen/forge/v1/template_pb";
import { renderWithApi, signIn } from "@/test/helpers";
import { AppShell } from "@/components/app-shell";
import AuditLog from "./(app)/audit/page";
import Catalog from "./(app)/page";
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
const ledger = { name: "services/ledger", ownerTeam: "finance", lifecycle: Lifecycle.EXPERIMENTAL, updateTime: ago(120) };

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

function forge(router: ConnectRouter) {
  router.service(AuthService, { getStatus: () => ({ subject: "ana", permissions: ["services.read"] }) });
  router.service(ServiceCatalogService, {
    listServices: () => ({ services: [payments, ledger] }),
    getService: (req) => {
      if (req.name !== "services/payments") throw new ConnectError("no such service", Code.NotFound);
      return { service: payments };
    },
  });
  router.service(DeployService, {
    listDeployments: (req) => ({ deployments: deployments.filter((d) => !req.service || d.service === req.service) }),
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
  sessionStorage.clear();
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
});

describe("templates", () => {
  it("lists the templates", async () => {
    renderWithApi(<Templates />, forge);
    expect((await screen.findByRole("link", { name: "nextjs" })).getAttribute("href")).toBe("/templates/nextjs");
    const card = within(screen.getByRole("link", { name: "nextjs" }).closest("li")!);
    expect(card.getByText("Next.js web app")).toBeTruthy();
    expect(card.getByText(/v1\.3\.0 · platform/)).toBeTruthy();
    expect(card.getByText("typescript")).toBeTruthy();
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
    window.history.replaceState(null, "", "/services/payments");
    renderWithApi(<AppShell>secret</AppShell>, forge);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login?return=%2Fservices%2Fpayments"));
    expect(screen.queryByText("secret")).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("shows who is logged in, as a reader or a writer, and signs out", async () => {
    renderWithApi(<AppShell>content</AppShell>, forge);
    expect(await screen.findByText("content")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Reader")).toBeTruthy();
    // The rail counts the services beside the link.
    expect((await screen.findByRole("link", { name: "Services 2" })).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(sessionStorage.getItem("forge.session")).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/login");
  });

  it("names a writer", async () => {
    renderWithApi(<AppShell>content</AppShell>, (router) => {
      router.service(AuthService, { getStatus: () => ({ permissions: ["services.read", "services.write"] }) });
    });
    expect(await screen.findByText("Writer")).toBeTruthy();
  });
});
