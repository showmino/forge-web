"use client";

import { Code } from "@connectrpc/connect";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { useApi } from "@/components/providers";
import { Cli } from "@/components/ui/cli";
import { inputClass } from "@/components/ui/field";
import { ErrorNote, Loading, Panel } from "@/components/ui/layout";
import type { DocSet } from "@/gen/forge/v1/docs_pb";
import { isCode } from "@/lib/api";
import { docHref, headings, ID_PREFIX, resolve, START } from "@/lib/docs";
import { shortCommit, when } from "@/lib/format";

// The docs reader: the pages of a service on the left, the page in the
// middle, its headings on the right. A page is Markdown from the service's
// repo; raw HTML in it is shown as text and never run, and images come
// through the API as data, never from another site.

type Open = (path: string, hash?: string) => void;

// The images a page may show; the API serves no others.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function useDocSet(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["docset", id],
    queryFn: () => api.docs.getDocSet({ service: `services/${id}` }).then((r) => r.docSet),
  });
}

// useHasDocs answers whether a service has docs, without an error when it has none.
export function useHasDocs(id: string): boolean {
  const set = useDocSet(id);
  return !!set.data;
}

// follow opens a page of the docs in place, unless the reader asked for a
// new tab or window.
function follow(e: MouseEvent, open: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open();
}

export function DocReader({ id, path, onOpen }: { id: string; path: string; onOpen: Open }) {
  const api = useApi();
  const set = useDocSet(id);
  const page = useQuery({
    queryKey: ["docpage", id, path],
    queryFn: () => api.docs.getDocPage({ service: `services/${id}`, path }).then((r) => r.page),
    enabled: !!set.data,
  });

  // A link to a heading of another page lands on it once the page is there.
  useEffect(() => {
    if (!page.data) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) document.getElementById(hash)?.scrollIntoView();
  }, [page.data]);

  if (set.isPending) return <Loading what="the docs" />;
  if (set.error) {
    return isCode(set.error, Code.NotFound) ? (
      <Panel className="p-6 text-center text-[13.5px] text-fg-2">
        {id} has no docs yet. Add <span className="font-mono text-[12.5px]">docs/index.md</span> to its repo, and they show here
        within a minute.
      </Panel>
    ) : (
      <ErrorNote error={set.error} />
    );
  }
  const ds = set.data!;
  const pages = ds.pages;
  const at = pages.findIndex((p) => p.path === path);
  const prev = at > 0 ? pages[at - 1] : undefined;
  const next = at >= 0 && at < pages.length - 1 ? pages[at + 1] : undefined;
  const cli = `forge docs get ${id}${path === START ? "" : ` ${path}`}`;
  const heads = page.data ? headings(page.data.markdown).filter((h) => h.depth === 2 || h.depth === 3) : [];

  const navLink = (p: { path: string; title: string }, children: ReactNode, className: string) => (
    <a
      key={p.path}
      href={docHref(id, p.path)}
      aria-current={p.path === path ? "page" : undefined}
      onClick={(e) => follow(e, () => onOpen(p.path))}
      className={className}
    >
      {children}
    </a>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 min-[861px]:grid-cols-[190px_minmax(0,1fr)] min-[1181px]:grid-cols-[200px_minmax(0,1fr)_210px] min-[1181px]:gap-8">
      <nav aria-label="Pages" className="hidden flex-col gap-0.5 min-[861px]:sticky min-[861px]:top-[76px] min-[861px]:flex">
        <div className="px-2.5 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-fg-3">{id}</div>
        {pages.map((p) =>
          navLink(
            p,
            p.title,
            `rounded-md px-2.5 py-1.5 text-[13.5px] no-underline ${
              p.path === path ? "bg-surface-2 font-medium text-fg shadow-[inset_2px_0_0_var(--ember)]" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
            }`,
          ),
        )}
      </nav>
      <div className="flex flex-col gap-1 min-[861px]:hidden">
        <label htmlFor="doc-page" className="type-small font-semibold">
          Page
        </label>
        <select id="doc-page" className={inputClass} value={at >= 0 ? path : ""} onChange={(e) => onOpen(e.target.value)}>
          {at < 0 ? <option value="">{path}</option> : null}
          {pages.map((p) => (
            <option key={p.path} value={p.path}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {page.isPending ? (
          <Loading what="the page" />
        ) : page.error ? (
          <>
            <ErrorNote error={page.error} />
            {path !== START
              ? navLink({ path: START, title: "" }, "Go to the start page", "text-[13.5px] text-info-fg no-underline hover:underline")
              : null}
          </>
        ) : (
          <article className="doc-article" aria-label={page.data!.title}>
            <Markdown id={id} path={path} set={ds} markdown={page.data!.markdown} onOpen={onOpen} />
            {prev || next ? (
              <div className="mt-8 flex justify-between gap-3 border-t border-line pt-4">
                {prev
                  ? navLink(
                      prev,
                      <>
                        <span className="text-[12px] text-fg-3">Previous</span>
                        <b className="font-medium text-fg">{prev.title}</b>
                      </>,
                      "flex min-w-0 flex-col rounded-md border border-line bg-surface px-3 py-2 !no-underline",
                    )
                  : null}
                {next
                  ? navLink(
                      next,
                      <>
                        <span className="text-[12px] text-fg-3">Next</span>
                        <b className="font-medium text-fg">{next.title}</b>
                      </>,
                      "ml-auto flex min-w-0 flex-col items-end rounded-md border border-line bg-surface px-3 py-2 text-right !no-underline",
                    )
                  : null}
              </div>
            ) : null}
          </article>
        )}
      </div>

      <aside aria-label="About this page" className="hidden flex-col gap-5 text-[13px] min-[1181px]:sticky min-[1181px]:top-[76px] min-[1181px]:flex">
        {heads.length > 0 ? (
          <nav aria-label="On this page">
            <div className="px-3 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-fg-3">On this page</div>
            <ul className="flex flex-col gap-0.5 border-l border-line">
              {heads.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className={`-ml-px block border-l border-transparent py-[3px] text-fg-2 no-underline hover:border-fg-3 hover:text-fg ${h.depth === 3 ? "pl-6" : "pl-3"}`}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <dl className="flex flex-col gap-2 text-fg-2">
          <div className="flex flex-col">
            <dt className="text-[11.5px] uppercase tracking-[0.06em] text-fg-3">Read from</dt>
            <dd>
              <span className="font-mono">{ds.branch || "the default branch"}</span> at{" "}
              <span className="font-mono">{shortCommit(page.data?.commit || ds.commit)}</span>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[11.5px] uppercase tracking-[0.06em] text-fg-3">Docs changed</dt>
            <dd>{when(ds.changeTime)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[11.5px] uppercase tracking-[0.06em] text-fg-3">Source</dt>
            <dd className="break-all font-mono text-[12px]">docs/{path}</dd>
          </div>
        </dl>
        <div className="flex flex-col items-start gap-2">
          {page.data?.editUrl.startsWith("https://github.com/") ? (
            <a
              href={page.data.editUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-line-strong bg-surface px-[9px] py-1 text-[12.5px] font-medium text-fg no-underline hover:border-fg-3"
            >
              Edit on GitHub
            </a>
          ) : null}
          <Cli command={cli} />
        </div>
      </aside>
    </div>
  );
}

// Markdown renders a page in the Forge Console look. Links between pages stay
// in the dashboard; other files in docs/ open on GitHub; other sites open as
// normal links.
function Markdown({ id, path, set, markdown, onOpen }: { id: string; path: string; set: DocSet; markdown: string; onOpen: Open }) {
  const components: Components = {
    a: ({ href = "", children }) => {
      const t = resolve(path, href);
      if (t.kind === "page") {
        const hash = t.hash ? ID_PREFIX + t.hash : "";
        return (
          <a href={docHref(id, t.path, hash)} onClick={(e) => follow(e, () => onOpen(t.path, hash))}>
            {children}
          </a>
        );
      }
      // Footnotes carry ids of their own (user-content-fn-1).
      if (t.kind === "anchor") return <a href={`#${t.hash.startsWith("user-content-") ? "" : ID_PREFIX}${t.hash}`}>{children}</a>;
      if (t.kind === "file") {
        return (
          <a href={githubFile(set, t.path)} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      return href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <>{children}</>
      );
    },
    img: ({ src, alt }) => {
      const t = typeof src === "string" ? resolve(path, src) : { kind: "outside" as const };
      if (t.kind !== "file") return <span className="text-fg-3">[image not shown: {alt || "an image from another site"}]</span>;
      return <DocImage id={id} path={t.path} alt={alt ?? ""} />;
    },
    table: ({ children }) => (
      <div className="doc-table">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSlug, { prefix: ID_PREFIX }], [rehypeHighlight, { detect: false }]]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}

// githubFile is a file of the repo's docs/ on GitHub, on the default branch.
function githubFile(set: DocSet, path: string): string {
  const repo = set.repoUrl.replace(/\/+$/, "");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) return "#";
  const parts = ["docs", ...path.split("/")].map(encodeURIComponent).join("/");
  return `${repo}/blob/${encodeURIComponent(set.branch || "HEAD")}/${parts}`;
}

function dataURL(mediaType: string, data: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${mediaType};base64,${btoa(bin)}`;
}

// DocImage fetches an image of the docs through the API: the repo is private.
function DocImage({ id, path, alt }: { id: string; path: string; alt: string }) {
  const api = useApi();
  const image = useQuery({
    queryKey: ["docasset", id, path],
    queryFn: () => api.docs.getDocAsset({ service: `services/${id}`, path }),
    staleTime: 5 * 60_000,
  });
  if (image.isPending) return <span className="text-fg-3">[loading {alt || path}]</span>;
  if (image.error || !image.data || !IMAGE_TYPES.includes(image.data.mediaType)) {
    return <span className="text-fg-3">[image not shown: {alt || path}]</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- a data URL from the API, which next/image cannot optimise
  return <img src={dataURL(image.data.mediaType, image.data.data)} alt={alt} />;
}

// DocsLink leads to a page of the docs on the Docs page.
export function DocsLink({ id, path, children }: { id: string; path: string; children: ReactNode }) {
  return (
    <Link href={docHref(id, path)} className="text-[13px] text-info-fg no-underline hover:underline">
      {children}
    </Link>
  );
}
