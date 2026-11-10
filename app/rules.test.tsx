import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalService } from "@/gen/forge/v1/approval_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { PolicyService } from "@/gen/forge/v1/policy_pb";
import { ADMIN, authAs, type Caller, READER, renderWithApi, signIn } from "@/test/helpers";
import Rules from "./(app)/rules/page";

// The Rules page: what Forge checks, and the modes admins set (phase 15, D).

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/rules",
}));

type World = { caller: Caller; modes: Record<string, string>; set: string[] };

const rule = (id: string, kind: string, title: string, switchable: boolean, defaultMode = "enforce") => ({ id, kind, title, switchable, defaultMode });
const RULES = [
  rule("images.pinned-version", "Images", "Images name a version", true),
  rule("resources.staging-single", "Resources", "Staging needs one instance", true, "warn"),
  rule("promotion.checked-deploy", "Promotion", "Promote the deploy that was checked", false),
];

function forge(w: World) {
  return (router: ConnectRouter) => {
    router.service(AuthService, authAs(w.caller));
    router.service(ApprovalService, { listApprovals: () => ({}) });
    router.service(PolicyService, {
      listRules: () => ({
        rules: RULES.map((r) => ({
          name: `rules/${r.id}`,
          kind: r.kind,
          title: r.title,
          description: `${r.title}.`,
          switchable: r.switchable,
          defaultMode: r.defaultMode,
          mode: r.switchable ? (w.modes[r.id] ?? r.defaultMode) : "enforce",
        })),
      }),
      updateRule: (req) => {
        const id = (req.rule?.name ?? "").replace("rules/", "");
        w.modes[id] = req.rule?.mode ?? "";
        w.set.push(`${id}=${req.rule?.mode}`);
        return { rule: req.rule };
      },
    });
  };
}

const world = (over: Partial<World> = {}): World => ({ caller: READER, modes: {}, set: [], ...over });

beforeEach(() => signIn());
afterEach(() => cleanup());

describe("the rules", () => {
  it("shows a reader each rule's mode, and the ones that are always enforced", async () => {
    renderWithApi(<Rules />, forge(world({ modes: { "images.pinned-version": "warn" } })));
    const table = within(await screen.findByRole("table", { name: "Rules" }));
    const row = (title: string) => table.getByText(title).closest("tr")!;
    expect(within(row("Images name a version")).getByText("Warn")).toBeTruthy();
    expect(within(row("Images name a version")).getByText("(default enforce)")).toBeTruthy();
    expect(within(row("Promote the deploy that was checked")).getByText("Always")).toBeTruthy();
    expect(table.queryByRole("group")).toBeNull();
    expect(screen.getByText("0 enforced, 2 warning only")).toBeTruthy();
  });

  it("lets an admin switch a rule's mode", async () => {
    const w = world({ caller: ADMIN });
    renderWithApi(<Rules />, forge(w));
    const group = within(await screen.findByRole("group", { name: "Mode of Images name a version" }));
    expect(group.getByRole("button", { name: "Enforce" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(group.getByRole("button", { name: "Off" }));
    await waitFor(() => expect(w.set).toEqual(["images.pinned-version=off"]));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Mode of Images name a version" })).getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true"));
    // A rule that guards Forge has no switch.
    expect(screen.queryByRole("group", { name: "Mode of Promote the deploy that was checked" })).toBeNull();
  });
});
