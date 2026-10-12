# How it is built

```text
browser ──(session token)──> forge-api ──> catalog, GitHub, Argo CD, Kubernetes
   ^
   └── pages from forge-web (Next.js): HTML, JS, CSS and /api/healthz only
```

The dashboard is a Next.js app with no endpoints of its own. The browser calls
forge-api directly with the reader's token, through the same API and the same
messages as the CLI.

## Where things are

| Path | What |
| --- | --- |
| `app/(app)/` | The pages behind the login, one folder per address |
| `app/login`, `app/auth/callback` | Sign-in |
| `components/app-shell.tsx` | The rail, the top bar, the login gate, Jump to |
| `components/service-actions.tsx` | The confirmation dialogs: deploy, promote, roll back, previews, delete |
| `components/operation-log.tsx` | Long work followed live |
| `components/doc-reader.tsx` | The docs reader |
| `components/ui/` | The shared parts of the look: buttons, pills, tables, dialogs, tabs, toasts |
| `lib/` | Logic that decides what a page shows, as pure functions with their own tests |
| `lib/auth/` | PKCE, the session in the browser |
| `gen/`, `proto/` | The API client, generated from a copy of Forge's protos |
| `proxy.ts`, `lib/csp.ts` | The Content-Security-Policy |

## Login and sessions

Login is the authorization code flow with PKCE against Forge's login service
(Dex, with GitHub behind it), as the public client forge-api names in
`GetServerInfo` (`lib/auth`). Right after the sign-in the page trades the ID
token for a Forge session (`AuthService.CreateSession`) that lasts 7 days,
kept in `localStorage`. More in [Security](security.md).

## Reading and acting

Pages are client components behind the login gate and read with TanStack
Query: lists refresh on their own while a page is open (running work every
5 seconds, deployments and previews every 30). After an action the queries it
touched are read again.

An action is a dialog that names its target, says what will happen, and starts
the work with the verb of its title. Long work (deploys, previews, deletes)
returns an operation, followed live with `WatchOperation`, which reconnects
when the stream drops. A toast names the command that does the same.

Errors say what went wrong and what to do next (`errorText` in `lib/api.ts`).
A refused or expired session sends the reader to sign in again, and back.

## The API client

`gen/` is generated from the protos in `proto/`, a copy from `showmino/forge`
at the commit in `proto/FORGE_COMMIT`. After an API change:

```sh
sh scripts/sync-proto.sh ../forge
```

The dashboard never gets ahead of the API: a field the live forge-api does not
send yet is empty, and a call it does not know answers Unimplemented.

## The docs reader

`/docs/<service>/<page>` and the Docs tab read pages with `DocsService`. A page
is Markdown, rendered by react-markdown with GitHub's extensions (remark-gfm),
heading ids (rehype-slug, prefixed `doc-`) and highlighted code
(rehype-highlight). Links between pages are rewritten to dashboard addresses;
images come through `GetDocAsset` as `data:` URLs. Rendering a large page is
slow, so it happens again only when the page changes. What the reader refuses
to do is in [Security](security.md).

## The look

The Forge Console design: a dark iron rail beside a light work surface, ember
for the one primary action and for work in progress, status pills with a dot
and a word, names in mono, and the CLI command on every page. Its tokens are
the Tailwind theme in `app/globals.css`; its parts are in `components/ui`. The
owner's mockup is `docs/design/forge-console.html` (sample data only). Fonts
are files in `app/fonts`, so a build fetches nothing from the internet but npm
packages.
