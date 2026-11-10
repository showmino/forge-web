import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { Resource_State, ResourceService } from "@/gen/forge/v1/resource_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { authAs, READER, renderWithApi, signIn } from "@/test/helpers";
import Adoption from "./(app)/adoption/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/adoption",
}));

const monday = (weeksAgo: number) => timestampFromDate(new Date(Date.UTC(2026, 10, 9) - weeksAgo * 7 * 86_400_000));

function forge(router: ConnectRouter) {
  router.service(AuthService, authAs(READER));
  router.service(AuditService, {
    getAdoption: () => ({
      last: { activeUsers: 5, deploys: 42, writes: 20, selfServed: 15 },
      previous: { activeUsers: 4, deploys: 30, writes: 10, selfServed: 6 },
      weeks: Array.from({ length: 12 }, (_, i) => ({ start: monday(11 - i), deploys: i, selfServed: i % 3, activeUsers: 2 })),
      since: monday(11),
    }),
  });
  router.service(ServiceCatalogService, {
    listServices: () => ({ services: [{ name: "services/payments", ownerTeam: "billing" }, { name: "services/search", ownerTeam: "discovery" }] }),
    listServiceChecks: () => ({ services: [{ service: "services/payments", passed: 5, applies: 5 }, { service: "services/search", passed: 1, applies: 5 }] }),
  });
  router.service(TeamService, {
    listTeams: () => ({ teams: [{ name: "teams/billing", memberCount: 6, oncall: "billing-primary" }, { name: "teams/discovery", memberCount: 2 }, { name: "teams/mobile", memberCount: 4 }] }),
  });
  router.service(DeployService, {
    listDeployments: () => ({
      deployments: [{ name: "deployments/search/production", service: "services/search", env: "production", commit: "a", health: Deployment_Health.DEGRADED, sync: Deployment_SyncStatus.SYNCED }],
    }),
  });
  router.service(ResourceService, {
    listResources: () => ({ resources: [{ name: "resources/payments/production/main", service: "services/payments", env: "production", state: Resource_State.READY }] }),
  });
}

beforeEach(() => signIn());
afterEach(() => cleanup());

describe("adoption", () => {
  it("leads with four numbers, then what is stuck", async () => {
    renderWithApi(<Adoption />, forge);
    const stat = (label: string) => screen.getByText(label, { selector: "div" }).parentElement!.textContent;
    await waitFor(() => expect(stat("Deployments (30 days)")).toContain("42"));
    expect(stat("Deployments (30 days)")).toContain("+40% vs the 30 before");
    expect(stat("Self-service")).toContain("75");
    expect(stat("Self-service")).toContain("15 of 20 changes");
    await waitFor(() => expect(stat("Active people")).toContain("of 12 team seats"));
    await waitFor(() => expect(stat("Resources applied")).toContain("across 1 team"));

    const items = within(await screen.findByRole("list", { name: "Action items" }));
    await waitFor(() => expect(items.getAllByRole("listitem")).toHaveLength(4));
    expect(items.getByText("1 team never shipped a service")).toBeTruthy();
    expect(items.getByText("1 service failing")).toBeTruthy();
    expect(items.getByText("1 service off the golden path")).toBeTruthy();
    expect(items.getByText("1 team without on-call")).toBeTruthy();
  });

  it("charts the weeks, and shows them as a table", async () => {
    renderWithApi(<Adoption />, forge);
    expect(await screen.findByRole("img", { name: "Deployments per week, the latest 11" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const table = within(screen.getByRole("table", { name: "Weeks" }));
    expect(table.getAllByRole("row")).toHaveLength(13);
  });
});
