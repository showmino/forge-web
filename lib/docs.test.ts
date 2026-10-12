import { describe, expect, it } from "vitest";
import { docHref, docPathOf, headings, resolve } from "./docs";

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
  it("gives the ids the page gets, outside code", () => {
    const md = "# Payments\n\n## Run `it` locally\n\n```sh\n## not a heading\n```go\n## still code\n```\n\n    ## indented code\n### [Errors](errors.md)\n## Run it locally\n";
    expect(headings(md)).toEqual([
      { depth: 1, text: "Payments", id: "doc-payments" },
      { depth: 2, text: "Run it locally", id: "doc-run-it-locally" },
      { depth: 3, text: "Errors", id: "doc-errors" },
      { depth: 2, text: "Run it locally", id: "doc-run-it-locally-1" },
    ]);
  });
});
