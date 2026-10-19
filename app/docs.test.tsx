import { readFileSync } from "node:fs";
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

// Mermaid needs a real browser's layout; the reader's use of it is what is tested here.
const diagrams = vi.hoisted(() => ({ fail: false, drawn: [] as string[] }));
vi.mock("@/lib/mermaid", () => ({
  isDark: () => false,
  drawDiagram: async (source: string) => {
    diagrams.drawn.push(source);
    if (diagrams.fail) throw new Error("Parse error on line 2:\nexpecting 'NODE'");
    return "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E";
  },
}));

const COMMIT = "707e4ddeb5a5c0ffee00000000000000000000aa";
const pages: Record<string, string> = {
  "index.md":
    "# Forge dashboard\n\nSee [the runbook](runbook.md#sign-in-fails), [this part](#pages) and [GitHub](https://github.com).\n\n" +
    "<script>alert('owned')</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [home](/settings) [up](../../forge.yaml)\n\nA claim.[^1]\n\n[^1]: The source.\n\n" +
    "## Pages\n\n| Page | What |\n| --- | --- |\n| runbook | fixes |\n\n- [x] done\n\n![flow](img/flow.png)\n\n![remote](https://example.com/a.png)\n\n```go\nfunc main() {}\n```\n",
  "runbook.md": "# Runbook\n\n## Sign-in fails\n\nCheck the login.\n",
  "flow.md": "# Flow\n\n```mermaid\nflowchart LR\n  a --> b\n```\n",
  "empty.md": "---\ntitle: Empty\n---\n",
  "kubernetes/Helm/02-installation.md": "---\ntitle: Installing Helm\ndescription: on macOS or Windows\n---\n# Installing Helm\n\nA single binary.\n",
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
            { path: "kubernetes/Helm/02-installation.md", title: "Installing Helm" },
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
          title: req.path === "runbook.md" ? "Runbook" : req.path?.endsWith("02-installation.md") ? "Installing Helm" : "Overview",
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
    searchDocs: (req) => {
      searches.push(req.query);
      if (req.query === "nothing here") return { results: [], totalSize: 0 };
      return {
        results: [
          { service: "services/forge-web", path: "runbook.md", title: "Runbook", lines: [{ number: 3, text: "## Sign-in fails" }] },
          { service: "services/forge-web", path: "index.md", title: "Overview", lines: [{ number: 3, text: "See the runbook to fix a failed sign-in." }] },
        ],
        totalSize: 7,
      };
    },
  });
}
let searches: string[] = [];

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  nav.router.push.mockClear();
  assetsAsked = [];
  searches = [];
  diagrams.fail = false;
  diagrams.drawn = [];
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

  it("searches the pages of every service and marks the words it found", async () => {
    renderWithApi(<Docs />, forge);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search the docs" }), { target: { value: "  Sign-in fails " } });
    const pages = within(await screen.findByRole("region", { name: "Pages that match" }));
    const first = pages.getAllByRole("link")[0];
    expect(first.getAttribute("href")).toBe("/docs/forge-web/runbook.md");
    expect(first.textContent).toContain("forge-web · docs/runbook.md");
    expect([...first.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Sign-in", "fails"]);
    expect(pages.getByText("Showing 2 of 7 pages. Add a word to narrow it.")).toBeTruthy();
    expect(searches).toEqual(["Sign-in fails"]);
    expect(screen.getByTitle("Same action from the terminal").textContent).toContain("forge docs search Sign-in fails");
    // No service is named so: the service cards go.
    expect(screen.queryByRole("list", { name: "Docs" })).toBeNull();

    // The same box still finds a service by its team, alongside the pages.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "platform" } });
    expect(await screen.findByRole("heading", { name: "Services" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Docs" })).getByRole("link", { name: /forge-web/ })).toBeTruthy();
  });

  it("says when no page matches, and waits for two letters before it asks", async () => {
    renderWithApi(<Docs />, forge);
    const box = await screen.findByRole("searchbox");
    fireEvent.change(box, { target: { value: "n" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(searches).toEqual([]);
    fireEvent.change(box, { target: { value: "nothing here" } });
    expect(await screen.findByText(/No page holds all of:/)).toBeTruthy();
    expect(screen.getByText(/No page holds all of:/).textContent).toContain("nothing here");
  });

  it("still narrows the services when the API cannot search", async () => {
    renderWithApi(<Docs />, (router) => {
      router.service(AuthService, { getStatus: () => ({ subject: "ana", permissions: ["services.read"] }) });
      router.service(DocsService, {
        listDocSets: () => ({ docSets: [{ service: "services/forge-web", ownerTeam: "platform-engineering", pageCount: 2 }] }),
        searchDocs: () => {
          throw new ConnectError("unimplemented", Code.Unimplemented);
        },
      });
    });
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "forge" } });
    expect(await screen.findByText(/cannot search the pages yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Docs" })).getByRole("link", { name: /forge-web/ })).toBeTruthy();
  });
});

describe("the reader", () => {
  it("does not cap the article width inside its flexible grid column", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const articleRule = styles.match(/\.doc-article\s*\{([^}]*)\}/)?.[1];
    expect(articleRule).toBeDefined();
    expect(articleRule).not.toContain("max-width:");
  });

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
    // A path outside docs/ is no link at all.
    expect(article.getByText("home").closest("a")).toBeNull();
    expect(article.getByText("up").closest("a")).toBeNull();
    // A footnote keeps its wiring, so its back link finds it.
    const ref = document.querySelector("article a[data-footnote-ref]")!;
    expect(ref.getAttribute("href")).toBe("#user-content-fn-1");
    expect(ref.id).toBe("user-content-fnref-1");
    expect(document.querySelector("article a[data-footnote-backref]")?.getAttribute("href")).toBe("#user-content-fnref-1");

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

  it("copies a code block with its button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    nav.params = { service: "forge-web" };
    renderWithApi(<DocPage />, forge);
    const article = within(await screen.findByRole("article", { name: "Overview" }));
    fireEvent.click(article.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("func main() {}"));
    expect(await article.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows folders in the side menu, the one of the page open, and no front matter", async () => {
    nav.params = { service: "forge-web", path: ["kubernetes", "Helm", "02-installation.md"] };
    renderWithApi(<DocPage />, forge);
    const article = within(await screen.findByRole("article", { name: "Installing Helm" }));
    expect(article.getByRole("heading", { name: "Installing Helm", level: 1 })).toBeTruthy();
    expect(document.querySelector("article")!.textContent).not.toContain("title:");
    const menu = screen.getByRole("navigation", { name: "Pages" });
    const kubernetes = within(menu).getByText("kubernetes").closest("details")!;
    const helm = within(kubernetes).getByText("Helm").closest("details")!;
    expect(kubernetes.open && helm.open).toBe(true);
    expect(within(helm).getByRole("link", { name: "Installing Helm" }).getAttribute("aria-current")).toBe("page");
    // Pages at the top stay at the top.
    expect(within(menu).getByRole("link", { name: "Runbook" }).closest("details")).toBeNull();
    nav.params = { service: "forge-web" };
  });

  it("says so when a page does not exist, and leads back to the start", async () => {
    nav.params = { service: "forge-web", path: ["gone.md"] };
    renderWithApi(<DocPage />, forge);
    expect((await screen.findByRole("alert")).textContent).toContain("does not exist");
    expect(screen.getByRole("link", { name: "Go to the start page" }).getAttribute("href")).toBe("/docs/forge-web");
  });

  it("draws a Mermaid diagram as an image", async () => {
    nav.params = { service: "forge-web", path: ["flow.md"] };
    renderWithApi(<DocPage />, forge);
    const img = await screen.findByRole("img", { name: "Diagram" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;/);
    expect(diagrams.drawn).toEqual(["flowchart LR\n  a --> b\n"]);
    expect(document.querySelector("article pre")).toBeNull();
  });

  it("shows a diagram's source, and why, when it cannot be drawn", async () => {
    diagrams.fail = true;
    nav.params = { service: "forge-web", path: ["flow.md"] };
    renderWithApi(<DocPage />, forge);
    expect((await screen.findByRole("note")).textContent).toBe("This diagram could not be drawn: Parse error on line 2:");
    expect(document.querySelector("article pre")!.textContent).toContain("a --> b");
    expect(screen.queryByRole("img", { name: "Diagram" })).toBeNull();
  });

  it("says a page is empty instead of showing nothing", async () => {
    nav.params = { service: "forge-web", path: ["empty.md"] };
    renderWithApi(<DocPage />, forge);
    expect(await screen.findByText(/This page is empty/)).toBeTruthy();
    expect(screen.getByText(/This page is empty/).textContent).toContain("docs/empty.md");
  });

  it("says how to add docs to a service that has none", async () => {
    nav.params = { service: "ledger" };
    renderWithApi(<DocPage />, forge);
    expect(await screen.findByText(/ledger has no docs yet/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  });
});
