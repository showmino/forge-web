import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { authAs, renderWithApi, signIn } from "@/test/helpers";
import Me from "./(app)/me/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/me",
}));

type T = { name: string; displayName: string; scopes: string[]; expireDays: number };

function forge(tokens: T[], made: { displayName: string; scopes: string[]; expireDays: number }[]) {
  return (router: ConnectRouter) => {
    router.service(AuthService, {
      ...authAs({ teams: ["billing"] }),
      getStatus: () => ({ subject: "ana", email: "ana@example.com", permissions: ["services.read"], teams: ["billing"] }),
      listTokens: () => ({
        tokens: tokens.map((t) => ({ ...t, createTime: timestampFromDate(new Date()), lastUseTime: timestampFromDate(new Date()), expireTime: t.expireDays ? timestampFromDate(new Date(Date.now() + t.expireDays * 86_400_000)) : undefined })),
      }),
      createToken: (req) => {
        made.push({ displayName: req.displayName, scopes: req.scopes, expireDays: req.expireDays });
        const t = { name: `tokens/tok_${tokens.length}`, displayName: req.displayName, scopes: ["read", ...req.scopes], expireDays: req.expireDays };
        tokens.push(t);
        return { token: { name: t.name, displayName: t.displayName, scopes: t.scopes }, secret: "fgp_s3cret" };
      },
      deleteToken: (req) => {
        tokens.splice(
          tokens.findIndex((t) => t.name === req.name),
          1,
        );
        return {};
      },
    });
  };
}

beforeEach(() => signIn());
afterEach(() => cleanup());

describe("your settings", () => {
  it("makes a token, shows it once, lists it and revokes it", async () => {
    const tokens: T[] = [];
    const made: { displayName: string; scopes: string[]; expireDays: number }[] = [];
    renderWithApi(<Me />, forge(tokens, made));
    expect(await screen.findByText(/No tokens/)).toBeTruthy();
    expect(await screen.findByText("ana@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New token" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "ci-deploys" } });
    fireEvent.click(dialog.getByLabelText(/Deploy, promote/));
    fireEvent.change(dialog.getByLabelText("Expires"), { target: { value: "7" } });
    expect(dialog.getByTitle("Same action from the terminal").textContent).toContain("forge token create ci-deploys --scope deploy --expires 7d");
    fireEvent.click(dialog.getByRole("button", { name: "Make token" }));
    await waitFor(() => expect(made).toEqual([{ displayName: "ci-deploys", scopes: ["deploy"], expireDays: 7 }]));

    // Shown once.
    expect((await screen.findByLabelText("The token")).textContent).toBe("fgp_s3cret");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const table = within(await screen.findByRole("table", { name: "Personal tokens" }));
    expect(table.getByText("ci-deploys")).toBeTruthy();
    expect(screen.queryByText("fgp_s3cret")).toBeNull();

    fireEvent.click(table.getByRole("button", { name: "Revoke ci-deploys" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(tokens).toHaveLength(0));
    expect(await screen.findByText(/No tokens/)).toBeTruthy();
  });

  it("refuses a name a token cannot have", async () => {
    renderWithApi(<Me />, forge([], []));
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Bad Name" } });
    expect((dialog.getByRole("button", { name: "Make token" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
