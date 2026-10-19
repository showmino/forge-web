import { describe, expect, it } from "vitest";
import { diagramSource, plainLine, docHref, docPathOf, type HastNode, headingsOf, marked, pageTree, resolve, searchTerms, stripFrontMatter } from "./docs";

describe("the side menu", () => {
  it("groups pages by folder, in the order of the pages", () => {
    const p = (path: string) => ({ path, title: path });
    expect(pageTree([p("index.md"), p("azure/aks.md"), p("kubernetes/Helm/01-intro.md"), p("kubernetes/Helm/02-install.md"), p("azure/vms.md"), p("runbook.md")])).toEqual([
      { kind: "page", page: p("index.md") },
      {
        kind: "folder",
        name: "azure",
        path: "azure",
        children: [
          { kind: "page", page: p("azure/aks.md") },
          { kind: "page", page: p("azure/vms.md") },
        ],
      },
      {
        kind: "folder",
        name: "kubernetes",
        path: "kubernetes",
        children: [
          {
            kind: "folder",
            name: "Helm",
            path: "kubernetes/Helm",
            children: [
              { kind: "page", page: p("kubernetes/Helm/01-intro.md") },
              { kind: "page", page: p("kubernetes/Helm/02-install.md") },
            ],
          },
        ],
      },
      { kind: "page", page: p("runbook.md") },
    ]);
  });

  it("leaves YAML front matter out of a page", () => {
    expect(stripFrontMatter("---\ntitle: Installing\ntags: [helm]\n---\n# Installing\n")).toBe("# Installing\n");
    expect(stripFrontMatter("# Plain\n\n---\n\nmore\n")).toBe("# Plain\n\n---\n\nmore\n");
  });
});

describe("addresses of pages", () => {
  it("puts the start page at the service and others below it", () => {
    expect(docHref("services/payments", "index.md")).toBe("/docs/payments");
    expect(docHref("payments", "api/errors codes.md", "doc-retries")).toBe("/docs/payments/api/errors%20codes.md#doc-retries");
    expect(docPathOf(undefined)).toBe("index.md");
    expect(docPathOf(["api", "errors%20codes.md"])).toBe("api/errors codes.md");
  });
});

describe("links in a page", () => {
  it("knows pages, files, anchors and the rest", () => {
    expect(resolve("index.md", "runbook.md#alerts")).toEqual({ kind: "page", path: "runbook.md", hash: "alerts" });
    expect(resolve("api/errors.md", "../index.md")).toEqual({ kind: "page", path: "index.md", hash: "" });
    expect(resolve("api/errors.md", "./codes%20list.md?x=1")).toEqual({ kind: "page", path: "api/codes list.md", hash: "" });
    expect(resolve("index.md", "img/flow.png")).toEqual({ kind: "file", path: "img/flow.png" });
    expect(resolve("index.md", "#top")).toEqual({ kind: "anchor", hash: "top" });
    for (const href of ["https://example.com", "mailto:a@b.c", "javascript:alert(1)", "//cdn.example.com/a.png", "/docs/x.md", "../forge.yaml", ""]) {
      expect(resolve("index.md", href)).toEqual({ kind: "outside" });
    }
  });
});

describe("headings of a page", () => {
  it("reads them from the rendered tree, with the ids it has", () => {
    const h = (tagName: string, id: string | undefined, ...children: HastNode[]): HastNode => ({ type: "element", tagName, properties: id ? { id } : {}, children });
    const t = (value: string): HastNode => ({ type: "text", value });
    const tree: HastNode = {
      type: "root",
      children: [
        h("h1", "doc-payments", t("Payments")),
        h("blockquote", undefined, h("h2", "doc-run-it", t("Run "), h("code", undefined, t("it")))),
        h("pre", undefined, t("## not a heading")),
        h("h3", "doc-errors", h("a", undefined, t("Errors"))),
      ],
    };
    expect(headingsOf(tree)).toEqual([
      { depth: 1, text: "Payments", id: "doc-payments" },
      { depth: 2, text: "Run it", id: "doc-run-it" },
      { depth: 3, text: "Errors", id: "doc-errors" },
    ]);
  });
});

describe("search results", () => {
  it("takes the words as the API does", () => {
    expect(searchTerms("  Restart the POD pod ")).toEqual(["restart", "the", "pod"]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
  });

  it("marks the words, whatever their case, and nothing else", () => {
    expect(marked("Restart the pod (a.k.a. Pod)", ["pod", "a.k.a."])).toEqual([
      { text: "Restart the ", hit: false },
      { text: "pod", hit: true },
      { text: " (", hit: false },
      { text: "a.k.a.", hit: true },
      { text: " ", hit: false },
      { text: "Pod", hit: true },
      { text: ")", hit: false },
    ]);
    expect(marked("text", [])).toEqual([{ text: "text", hit: false }]);
  });
});

describe("diagrams", () => {
  const block = (cls: string[]): HastNode => ({
    type: "element",
    tagName: "pre",
    children: [{ type: "element", tagName: "code", properties: { className: cls }, children: [{ type: "text", value: "graph TD\n  a-->b\n" }] }],
  });
  it("finds the source of a mermaid block only", () => {
    expect(diagramSource(block(["language-mermaid"]))).toBe("graph TD\n  a-->b\n");
    expect(diagramSource(block(["hljs", "language-go"]))).toBeNull();
    expect(diagramSource(undefined)).toBeNull();
  });
});

describe("found lines", () => {
  it("are shown without the Markdown they start with", () => {
    expect(["## Refunds stuck", "- Restart it", "1. First", "- [x] done", "> quoted", "  * nested", "#hashtag", "plain"].map(plainLine)).toEqual([
      "Refunds stuck",
      "Restart it",
      "First",
      "done",
      "quoted",
      "nested",
      "#hashtag",
      "plain",
    ]);
  });
});
