# Writing docs

Any service in the catalog can have docs that show in the dashboard, next to
its deployments. They are Markdown files in the service's own repository,
reviewed and merged like code. Nothing is built or published: Forge reads them
from the default branch, and a merged change shows here within a minute.

## Start

Add `docs/index.md` to the repo. That is the start page; a repo without it
has no docs. Services made from the `go-grpc` or `nextjs` templates (`v1.5.0`
and later) start with `docs/index.md` and `docs/runbook.md`.

```text
docs/
  index.md          the start page
  runbook.md
  api/errors.md     folders are fine
  img/flow.png      images the pages use
```

## Order and titles

Without anything else, the start page comes first and the others follow by
path. A page's title is its first `# ` heading, or else its file name.

To choose the order and titles, list the pages in `forge.yaml`:

```yaml
docs:
  - path: index.md
    title: Overview        # optional
  - path: runbook.md
  - path: api/errors.md
```

With a list, the side menu shows the listed pages only (the start page always).
A page that is not listed can still be opened by a link.

## What works

| Write | Shows as |
| --- | --- |
| Headings, lists, quotes, **bold**, `code` | The dashboard's type |
| Tables, task lists `- [x]`, footnotes `[^1]`, ~~strikethrough~~ | As on GitHub |
| Fenced code with a language (` ```go `) | Highlighted |
| `[a link](runbook.md)`, `[a part](runbook.md#alerts)` | A page of the docs, opened in the dashboard |
| `[a link](https://example.com)` | Another site, in a new tab |
| `![a diagram](img/flow.png)` | The image, fetched through Forge |
| A ` ```mermaid ` block | The diagram, drawn in the reader's browser |

Links between pages are relative to the page, as on GitHub. A heading links
as `#` and its text in lower case with dashes: `## Sign-in fails` is
`#sign-in-fails`.

## What does not

- **Raw HTML** is shown as text, never run: a page cannot add scripts, frames
  or styles to the dashboard.
- **Images** are png, jpeg, gif or webp, at most 5 MiB. SVG is not shown,
  because it can carry script. Images from other sites are not loaded.
- **Links outside `docs/`** (`../README.md`, `/src`) are not links in the
  dashboard. Other files in `docs/` open on GitHub.
- **Mermaid diagrams** are drawn as a picture: links and click actions in a
  diagram do nothing, and labels are plain text. A diagram Mermaid cannot
  read shows its source, with Mermaid's message.

Every page is found by the search on the Docs page, the search box at the top
of every page (Ctrl+K or ⌘K) and `forge docs search` within a minute of its
merge: a page matches when it holds every word
searched for.

Limits: a page at most 1 MiB, at most 500 pages, at most 32 MiB of pages
together.

## Check before a push

```sh
forge docs lint                    # in the repo: the start page, the docs: list, links and images
forge docs get <service> --pages   # what Forge reads from the default branch
forge docs get <service> runbook.md
```
