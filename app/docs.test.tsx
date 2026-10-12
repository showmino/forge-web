import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { DocsService } from "@/gen/forge/v1/docs_pb";
import { renderWithApi, signIn } from "@/test/helpers";
import DocPage from "./(app)/docs/[service]/[[...path]]/page";
import Docs from "./(app)/docs/page";

// The docs reader against an in-memory Forge API with the shapes of the live
// one: services/forge-web, pages under docs/.

const nav = vi.hoisted(() => ({ params: {} as Record<string, unknown>, router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => nav.router,
  usePathname: () => "/docs",
}));

const COMMIT = "707e4ddeb5a5c0ffee00000000000000000000aa";
const pages: Record<string, string> = {
  "index.md":
    "# Forge dashboard\n\nSee [the runbook](runbook.md#sign-in-fails), [this part](#pages) and [GitHub](https://github.com).\n\n" +
    "<script>alert('owned')</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n" +
    "## Pages\n\n| Page | What |\n| --- | --- |\n| runbook | fixes |\n\n- [x] done\n\n![flow](img/flow.png)\n\n![remote](https://example.com/a.png)\n\n```go\nfunc main() {}\n```\n",
  "runbook.md": "# Runbook\n\n## Sign-in fails\n\nCheck the login.\n",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
let assetsAsked: string[] = [];

function forge(router: ConnectRouter) {
  router.service(AuthService, { getStatus: () => ({ subject: "ana", permissions: ["services.read"] }) });
  router.service(DocsService, {
    listDocSets: () => ({
      docSets: [{ service: "services/forge-web", ownerTeam: "platform-engineering", pageCount: 2, commit: COMMIT, changeTime: timestampFromDate(new Date(Date.now() - 3 * 60_000)) }],
    }),
    getDocSet: (req) => {
      if (req.service !== "services/forge-web") throw new ConnectError(`${req.service} has no docs: its repo has no docs/ folder`, Code.NotFound);
      return {
        docSet: {
          service: req.service,
          commit: COMMIT,
          branch: "main",
          repoUrl: "https://github.com/showmino/forge-web",
          pages: [
            { path: "index.md", title: "Overview" },
            { path: "runbook.md", title: "Runbook" },
          ],
        },
      };
    },
    getDocPage: (req) => {
      const md = pages[req.path || "index.md"];
      if (!md) throw new ConnectError(`services/forge-web has no page docs/${req.path}`, Code.NotFound);
      return {
        page: {
          service: req.service,
          path: req.path,
          title: req.path === "runbook.md" ? "Runbook" : "Overview",
          markdown: md,
          commit: COMMIT,
          editUrl: `https://github.com/showmino/forge-web/edit/main/docs/${req.path}`,
        },
      };
    },
    getDocAsset: (req) => {
      assetsAsked.push(req.path);
      return { mediaType: "image/png", data: PNG, commit: COMMIT };
    },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  nav.router.push.mockClear();
  assetsAsked = [];
  signIn();
});
afterEach(cleanup);

describe("the docs page", () => {
  it("lists the services that have docs", async () => {
    renderWithApi(<Docs />, forge);
    const card = await screen.findByRole("link", { name: /forge-web/ });
    expect(card.getAttribute("href")).toBe("/docs/forge-web");
    expect(card.textContent).toContain("2 pages");
    expect(card.textContent).toContain("Changed 3 min ago");
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge docs list");
  });
});

describe("the reader", () => {
  it("renders a page in the dashboard's look, with links that stay in the docs", async () => {
    nav.params = { service: "forge-web" };
    renderWithApi(<DocPage />, forge);
    const article = within(await screen.findByRole("article", { name: "Overview" }));
    expect(article.getByRole("heading", { name: "Forge dashboard", level: 1 })).toBeTruthy();

    // A link to another page stays in the dashboard and opens it in place.
    const runbook = article.getByRole("link", { name: "the runbook" });
    expect(runbook.getAttribute("href")).toBe("/docs/forge-web/runbook.md#doc-sign-in-fails");
    fireEvent.click(runbook);
    expect(nav.router.push).toHaveBeenCalledWith("/docs/forge-web/runbook.md#doc-sign-in-fails");
    expect(article.getByRole("link", { name: "this part" }).getAttribute("href")).toBe("#doc-pages");
    expect(article.getByRole("heading", { name: "Pages" }).id).toBe("doc-pages");
    const site = article.getByRole("link", { name: "GitHub" });
    expect(site.getAttribute("href")).toBe("https://github.com");
    expect(site.getAttribute("target")).toBe("_blank");

    // Raw HTML is shown as text and never run: no script, no element with a handler.
    expect(document.querySelector("article script")).toBeNull();
    expect(document.querySelector("article [onerror]")).toBeNull();
    expect(document.querySelector("article")!.textContent).toContain("<script>alert('owned')</script>");
    expect(article.getByText("bad").closest("a")?.getAttribute("href") ?? "").not.toContain("javascript");

    // Tables, task lists and highlighted code.
    expect(article.getByRole("table")).toBeTruthy();
    expect(article.getByRole("checkbox")).toBeTruthy();
    expect(document.querySelector("article pre code.language-go")).toBeTruthy();

    // An image of the docs comes through the API as data; one from another site is not loaded.
    const img = await article.findByRole("img", { name: "flow" });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
    expect(assetsAsked).toEqual(["img/flow.png"]);
    expect(article.getByText(/image not shown: remote/)).toBeTruthy();

    // The side menu, the headings of the page, and where it comes from.
    const menu = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(menu.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("navigation", { name: "On this page" })).getByRole("link", { name: "Pages" }).getAttribute("href")).toBe("#doc-pages");
    expect(screen.getByRole("link", { name: "Edit on GitHub" }).getAttribute("href")).toBe("https://github.com/showmino/forge-web/edit/main/docs/index.md");
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge docs get forge-web");
    fireEvent.click(screen.getByRole("link", { name: /Next\s*Runbook/ }));
    expect(nav.router.push).toHaveBeenCalledWith("/docs/forge-web/runbook.md");
  });

  it("says so when a page does not exist, and leads back to the start", async () => {
    nav.params = { service: "forge-web", path: ["gone.md"] };
    renderWithApi(<DocPage />, forge);
    expect((await screen.findByRole("alert")).textContent).toContain("does not exist");
    expect(screen.getByRole("link", { name: "Go to the start page" }).getAttribute("href")).toBe("/docs/forge-web");
  });

  it("says how to add docs to a service that has none", async () => {
    nav.params = { service: "ledger" };
    renderWithApi(<DocPage />, forge);
    expect(await screen.findByText(/ledger has no docs yet/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  });
});
