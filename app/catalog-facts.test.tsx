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

// A service's tier and SLO, and a team's members (phase 15, B).

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

type World = { caller: Caller; updates: { paths: string[]; tier: number; slo: string }[] };

function forge(w: World) {
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller, (s) => services.find((x) => x.name === s)?.ownerTeam ?? ""));
    router.service(ServiceCatalogService, {
      listServices: () => ({ services }),
      updateService: (req) => {
        w.updates.push({ paths: req.updateMask?.paths ?? [], tier: req.service?.tier ?? 0, slo: req.service?.slo ?? "" });
        return { service: { name: req.service?.name, etag: "2" } };
      },
    });
    router.service(DeployService, { listDeployments: () => ({}) });
    router.service(TemplateService, { listTemplates: () => ({}) });
    router.service(ResourceService, { listResources: () => ({}) });
    router.service(TeamService, {
      listTeams: () => ({
        teams: [
          { name: "teams/billing", displayName: "Billing", memberCount: 6 },
          { name: "teams/growth", memberCount: 3 },
        ],
      }),
    });
  };
}

const world = (over: Partial<World> = {}): World => ({ caller: READER, updates: [], ...over });

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

describe("the teams", () => {
  it("shows each team's members, and nothing about on-call", async () => {
    renderWithApi(<Ownership />, forge(world({ caller: ADMIN })));
    const teams = within(await screen.findByRole("table", { name: "Teams" }));
    const billing = teams.getByText("billing").closest("tr")!;
    expect(within(billing).getByText("6")).toBeTruthy();
    expect(teams.queryByText("On-call")).toBeNull();
    expect(screen.queryByText(/on-call/i)).toBeNull();
  });
});

describe("the catalog's filters", () => {
  it("offer no golden path", async () => {
    renderWithApi(<Catalog />, forge(world()));
    await screen.findByRole("link", { name: "payments" });
    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...status.options].map((o) => o.value)).toEqual(["all", "attention", "healthy", "ahead"]);
  });
});
