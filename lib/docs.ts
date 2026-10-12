import { serviceId } from "@/lib/api";

// The rules of the docs reader that need no React: where a page lives in the
// dashboard, what a link in a page points at, and the headings of a page.
// They follow forge's internal/docs (paths relative to docs/, no "..").

export const START = "index.md";

// docHref is a page's address in the dashboard: /docs/<service>/<path>.
export function docHref(service: string, path: string, hash = ""): string {
  const parts = path === START ? [] : path.split("/").map(encodeURIComponent);
  return ["", "docs", encodeURIComponent(serviceId(service)), ...parts].join("/") + (hash ? `#${hash}` : "");
}

// docPathOf turns the [[...path]] segments of the reader's address back into a path under docs/.
export function docPathOf(segments: string[] | undefined): string {
  if (!segments?.length) return START;
  return segments.map((s) => decodeURIComponent(s)).join("/");
}

export function isPage(path: string): boolean {
  return /\.md$/i.test(path);
}

export type Target =
  | { kind: "page"; path: string; hash: string }
  | { kind: "file"; path: string }
  | { kind: "anchor"; hash: string }
  | { kind: "outside" };

function join(from: string, target: string): string | null {
  const out = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

// resolve says what a link on page `from` points at: another page of the
// docs, a file in docs/ (an image), an anchor on this page, or anything else,
// which is left as it is written.
export function resolve(from: string, href: string): Target {
  if (!href || href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "outside" };
  if (href.startsWith("#")) return { kind: "anchor", hash: href.slice(1) };
  if (href.startsWith("/")) return { kind: "outside" };
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : "";
  let target = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = target.indexOf("?");
  if (queryAt >= 0) target = target.slice(0, queryAt);
  try {
    target = decodeURIComponent(target);
  } catch {
    // Not percent-encoded after all: take it as written.
  }
  const path = join(from, target);
  if (path === null || path === "") return { kind: "outside" };
  return isPage(path) ? { kind: "page", path, hash } : { kind: "file", path };
}

export type Heading = { depth: number; text: string; id: string };

// The ids of a page's headings start with this, so a page never takes an id the dashboard uses.
export const ID_PREFIX = "doc-";

// HastNode is the little of an HTML syntax tree headingsOf reads.
export type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const DEPTHS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function textOf(n: HastNode): string {
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(textOf).join("");
}

// headingsOf lists the headings of a rendered page with the ids it has, in
// order: the same tree the reader shows, so the ids always match.
export function headingsOf(tree: HastNode): Heading[] {
  const out: Heading[] = [];
  const walk = (n: HastNode) => {
    const depth = n.type === "element" && n.tagName ? DEPTHS[n.tagName] : undefined;
    const id = n.properties?.id;
    if (depth && typeof id === "string") {
      out.push({ depth, text: textOf(n).trim(), id });
      return;
    }
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
}
