import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSettings } from "@/components/service-settings";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { type Service, ServiceCatalogService, ServiceSchema } from "@/gen/forge/v1/catalog_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { ResourceService } from "@/gen/forge/v1/resource_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { TemplateService } from "@/gen/forge/v1/template_pb";
import { create } from "@bufbuild/protobuf";
import { ADMIN, authAs, type Caller, READER, renderWithApi, signIn } from "@/test/helpers";
import Catalog from "./(app)/services/page";
import Ownership from "./(app)/ownership/page";
import { GoldenPath } from "@/components/golden-path";

// A service's tier and SLO, and a team's members and on-call (phase 15, B).

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const services = [
  { name: "services/payments", ownerTeam: "billing", owners: ["ana@example.com"], tier: 1, slo: "99.95%", etag: "1" },
  { name: "services/ledger", ownerTeam: "billing", owners: ["ana@example.com"], tier: 2 },
  { name: "services/notes", ownerTeam: "growth", owners: ["bo@example.com"] },
];

type World = { caller: Caller; oncall: Record<string, string>; updates: { paths: string[]; tier: number; slo: string }[] };

function forge(w: World) {
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller, (s) => services.find((x) => x.name === s)?.ownerTeam ?? ""));
    router.service(ServiceCatalogService, {
      listServices: () => ({ services }),
      updateService: (req) => {
        w.updates.push({ paths: req.updateMask?.paths ?? [], tier: req.service?.tier ?? 0, slo: req.service?.slo ?? "" });
        return { service: { name: req.service?.name, etag: "2" } };
      },
      listServiceChecks: (req) => {
        const all = [
          {
            service: "services/payments",
            passed: 4,
            applies: 4,
            checks: [
              { name: "ci", title: "CI pipeline", applies: false, detail: "no repo: it runs an image or a chart someone else built" },
              { name: "slo", title: "SLO defined", applies: true, passed: true, detail: "availability target 99.95%" },
              { name: "tracing", title: "Tracing with OpenTelemetry", applies: true, passed: true, detail: "it sends traces (service.tracing)" },
              { name: "runbook", title: "Runbook", applies: false, detail: "no repo to keep one in" },
              { name: "oncall", title: "On-call rotation", applies: true, passed: true, detail: "team billing is on call as billing-primary" },
            ],
          },
          { service: "services/ledger", passed: 1, applies: 3, checks: [] },
          { service: "services/notes", passed: 3, applies: 3, checks: [] },
        ];
        return { services: req.service ? all.filter((c) => c.service === req.service) : all };
      },
    });
    router.service(DeployService, { listDeployments: () => ({}) });
    router.service(TemplateService, { listTemplates: () => ({}) });
    router.service(ResourceService, { listResources: () => ({}) });
    router.service(TeamService, {
      listTeams: () => ({
        teams: [
          { name: "teams/billing", displayName: "Billing", memberCount: 6, oncall: w.oncall.billing ?? "" },
          { name: "teams/growth", memberCount: 3, oncall: w.oncall.growth ?? "" },
        ],
      }),
      updateTeam: (req) => {
        const slug = (req.team?.name ?? "").replace("teams/", "");
        w.oncall[slug] = req.team?.oncall ?? "";
        return { team: req.team };
      },
    });
  };
}

const world = (over: Partial<World> = {}): World => ({ caller: READER, oncall: {}, updates: [], ...over });

beforeEach(() => signIn());
afterEach(() => cleanup());

describe("the catalog's tiers", () => {
  it("shows each service's tier and filters by it", async () => {
    renderWithApi(<Catalog />, forge(world()));
    const row = (id: string) => screen.getByRole("link", { name: id }).closest("tr")!;
    await screen.findByRole("link", { name: "payments" });
    expect(within(row("payments")).getByText("Critical")).toBeTruthy();
    expect(within(row("ledger")).getByText("High")).toBeTruthy();
    expect(within(row("notes")).getByText("Not set")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "1" } });
    expect(screen.queryByRole("link", { name: "ledger" })).toBeNull();
    expect(screen.getByRole("link", { name: "payments" })).toBeTruthy();
  });
});

describe("a service's tier and SLO in its settings", () => {
  const payments = create(ServiceSchema, services[0]) as Service;

  it("changes them, and says the command", async () => {
    const w = world({ caller: { teams: ["billing"] } });
    renderWithApi(<ServiceSettings service={payments} />, forge(w));
    fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("SLO target"), { target: { value: "99.9%" } });
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge service update payments --tier 2 --slo 99.9%");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(w.updates).toEqual([{ paths: ["tier", "slo"], tier: 2, slo: "99.9%" }]));
  });

  it("refuses an SLO that is not a percentage", async () => {
    renderWithApi(<ServiceSettings service={payments} />, forge(world({ caller: { teams: ["billing"] } })));
    fireEvent.change(screen.getByLabelText("SLO target"), { target: { value: "high" } });
    expect(screen.getByRole("alert").textContent).toContain("percentage");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the teams' on-call", () => {
  it("shows members and on-call, and names a team that owns services but pages nobody", async () => {
    renderWithApi(<Ownership />, forge(world({ oncall: { billing: "billing-primary" } })));
    const teams = within(await screen.findByRole("table", { name: "Teams" }));
    const billing = teams.getByText("billing").closest("tr")!;
    expect(within(billing).getByText("6")).toBeTruthy();
    expect(within(billing).getByText("billing-primary")).toBeTruthy();
    expect(within(teams.getByText("growth").closest("tr")!).getByText("No on-call rotation")).toBeTruthy();
    // A reader cannot change it.
    expect(teams.queryByRole("button", { name: /Set the on-call/ })).toBeNull();
  });

  it("lets an admin set a team's on-call", async () => {
    const w = world({ caller: ADMIN });
    renderWithApi(<Ownership />, forge(w));
    fireEvent.click(await screen.findByRole("button", { name: "Set the on-call of growth" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Rotation"), { target: { value: "growth-primary" } });
    expect(dialog.getByTitle("Same action from the terminal").textContent).toContain("forge team update growth --oncall growth-primary");
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.oncall.growth).toBe("growth-primary"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the golden path", () => {
  it("shows a service's checks, and what does not apply", async () => {
    renderWithApi(<GoldenPath id="payments" />, forge(world()));
    expect(await screen.findByText("4 of 4")).toBeTruthy();
    const checks = within(screen.getByRole("list", { name: "Golden-path checks" }));
    expect(checks.getByText(/CI pipeline/).textContent).toContain("does not apply");
    expect(checks.getByText(/SLO defined/).textContent).toContain("passes");
    expect(checks.getByText("availability target 99.95%")).toBeTruthy();
  });

  it("lets the Catalog keep only the services off the path", async () => {
    renderWithApi(<Catalog />, forge(world()));
    await screen.findByRole("link", { name: "payments" });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "offpath" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "payments" })).toBeNull());
    expect(screen.getByRole("link", { name: "ledger" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "notes" })).toBeNull();
  });
});
