# Working on forge-web

This file is for every coding agent that works in this repository (GitHub
Copilot, Claude Code, Codex, Cursor and others), and for people. Tool-specific
files (`CLAUDE.md`, `.github/copilot-instructions.md`) only point here.

## What this is

The web dashboard of Forge, the `showmino` internal developer platform. Every
Forge runs it from the `forge` chart (`web.image`, an image of this repo); at
showmino that is `https://forge.showmino.com`. Since 2026-10-29 it is no longer
deployed as a Forge service of its own, so there is no staging copy. It is a
Next.js app and a thin
client of the Forge API: every call goes from the browser to forge-api with the
reader's own token, and the API decides what they may see and do. The server
here only serves pages and `/api/healthz`; it holds no secrets and has no
endpoints of its own.

The platform lives in `showmino/forge`. **Its `AGENTS.md` has the owner's
rules, and they apply here too**; the ones that matter most in this repo are
repeated below. Its `docs/agents/status.md` says what is built and live, and
its `docs/agents/verifying.md` is the runbook for the cluster. `README.md` here
says how this app is built, page by page.

## Rules

- **Merging to `main` builds the image** `ghcr.io/showmino/forge-web:<sha7>`;
  nothing is deployed. The tests run once, on the pull request, and not again
  after the merge (the owner's rule), so never push to `main` directly, and
  before merging make sure the branch contains the current `main`
  (`gh api repos/showmino/forge-web/compare/main...<branch> --jq .behind_by`
  must be 0; if not, merge `main` into the branch and wait for `test` again).
  That is the normal path and needs no extra OK. Merge only when every check
  of the commit has passed (a job skipped by design on a pull request does not
  count against it); read the result, do not assume it.
- **A release is a tag** `vX.Y.Z` on a merged commit of `main` (free to do,
  as in `showmino/forge`): `release.yml` gives that commit's image the
  version. Check locally with `npm run dev:mock` before tagging: there is no
  staging.
- **Production needs the owner.** It changes when the forge chart names the
  new version: a pull request in `showmino/kubernetes` that sets
  `web.image.tag` in `apps/helm/forge/production/app.yaml`, with the render,
  `kubectl diff` and a server dry run (the rollout procedure of
  `showmino/forge`'s AGENTS.md). The owner merges it. Deleting anything (a
  branch too, also a merged one) and any setting on GitHub also need the owner.
- **The cluster is production.** There is one cluster. Read-only commands are
  fine; anything that changes it needs the owner's OK each time.
- **Never print, log or commit a token**: ID tokens, session tokens
  (`fgs_…`), what is in the browser's storage. No secret belongs in this
  repo or in the image: `NEXT_PUBLIC_*` values are public by design.
- **A risky change gets one independent review** before it merges: the
  login, the session, the Content-Security-Policy, anything a stranger's
  input reaches.
- Never force-push `main`.

## How to work here

```sh
npm ci
npm run lint && npm run typecheck && npm test   # what CI runs
npm run dev      # http://localhost:3000, calls the API at http://localhost:8080
npm run build    # no API address is built in: the server reads FORGE_API_URL when it starts
sh scripts/sync-proto.sh ../forge   # after the API's protos change: copies them and regenerates gen/
```

Write the test first. `gen/` is committed and CI checks it matches `proto/`.

### Things that are decided

- **No endpoints of its own, no secrets on the server.** If the dashboard
  needs something, the Forge API grows it, and the CLI gets it too.
- **The design is the Forge Console** (the owner's design artifact): dark
  iron rail, light work surface, the tokens in `app/globals.css`, Archivo for
  titles, IBM Plex Sans and Mono. Every page shows the CLI command that does
  the same. Status is a dot and a word; only running work moves.
- **Show what Forge knows, nothing invented.** No numbers, stages or warnings
  the API cannot back. Where the design shows something Forge does not
  measure, leave it out and say so in the pull request.
- **Plain Tailwind**, no component library. Client components behind the
  auth shell; data with TanStack Query.
- **The session** is a Forge session token kept in `localStorage` for 7 days,
  shared across tabs (`lib/auth`). There is no refresh token.
- **Scripts run only with the request's nonce** (`proxy.ts`, `lib/csp.ts`):
  no inline script without it, so never add `'unsafe-inline'` to
  `script-src`, and give any inline `<script>` the nonce from the layout.
  Pages are rendered per request because of it.
- **Fonts are files in `app/fonts`.** A build fetches nothing from the
  internet except npm packages.
- **Its address** comes from `forge.yaml` (`run.host: forge`), and the API it
  calls from `run.env` `FORGE_API_URL`, read when the server starts.

### Conventions

| Rule | Where it lives |
| --- | --- |
| Pages are rendered in tests against an in-memory Forge API (Connect's router transport), never a mock of `fetch` | `app/*.test.tsx`, `test/helpers.tsx` |
| Test data has the shapes of the live API (`services/payments`, `templates/nextjs`) | the same |
| Logic that decides what a page shows is a pure function with its own tests | `lib/status.ts`, `lib/overview.ts`, `lib/format.ts` |
| Shared pieces of the look | `components/ui/` |
| An action is a dialog that names its target, says what will happen, and starts the work with the verb of its title | `components/service-actions.tsx` |
| Long work is followed live and reconnects when the stream drops | `components/operation-log.tsx` |
| Errors say what went wrong and what to do next, in the reader's words | `errorText` in `lib/api.ts` |
| Layout works at phone width with no sideways scroll; light and dark | check both when you change a page |

### Mistakes that have been made here

- Test data with shapes the API never sends (`nextjs` for `templates/nextjs`):
  the tests passed and the page was broken.
- An effect that depended on an unstable object and re-ran forever.
- Adding a column to a table without checking it still fits at 1440px.
- A build that failed because it fetched fonts from Google; they are in the
  repo now.
- Adding a field to `forge.yaml` before the forge-api that knows it was live:
  an older API rejects unknown fields and every deploy fails.

## Keeping this true

A change that alters a fact in this file or in `README.md` updates it in the
same pull request. Do not copy these rules into a tool's own file or memory
and edit them there: point at this file. A new rule from the owner goes into
"Rules", here or in `showmino/forge`'s `AGENTS.md` when it is about the whole
platform.
