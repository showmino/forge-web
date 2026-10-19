# Working on it

## Run it locally

```sh
npm ci
npm run dev        # http://localhost:3000, calls the API at http://localhost:8080
```

The API must accept the dashboard: start forge-api with
`--oidc-web-client-id forge-web --cors-origins http://localhost:3000`, and give
its Dex a public client `forge-web` with the redirect URI
`http://localhost:3000/auth/callback`. Set `NEXT_PUBLIC_FORGE_API_URL` for
another API; it is read at build time.

### Run it without a login

```sh
npm run dev:mock
```

No cluster, no forge-api, no GitHub. `dev/mock-api.ts` stands in for the API
(the same in-memory router the tests use, with its own small catalog), and a
fake session is written before anything asks for one. It is not a simulator:
a write does not change what Argo CD would actually report, and every
operation succeeds after a couple of seconds. Good for looking at a page;
`npm test` is still how behavior is checked (see below). Never on in a real
deployment: `NEXT_PUBLIC_MOCK_API` is read at build time, and the build that
makes the shipped image never sets it.

## Test it

```sh
npm run lint && npm run typecheck && npm test   # what CI runs
npm run build
```

Pages are rendered in tests against an in-memory Forge API (Connect's router
transport), never a mock of `fetch`. Test data has the shapes of the live API
(`services/payments`, `templates/nextjs`). Write the test first.

| Tests | Cover |
| --- | --- |
| `app/pages.test.tsx` | Every page as a reader sees it, the frame, Jump to |
| `app/actions.test.tsx` | A writer's actions: create, deploy, promote, roll back, previews, settings, delete |
| `app/overview.test.tsx` | The Overview |
| `app/docs.test.tsx` | The docs reader: links, raw HTML, images, missing pages |
| `lib/*.test.ts` | The pure functions that decide what pages show |
| `lib/auth/*.test.ts` | PKCE and the session |

Check a changed page at phone width, at 1440px, and in light and dark.

## Change it

- **A new page:** a folder under `app/(app)/`, a link in the rail
  (`components/app-shell.tsx`) and in Jump to (`lib/palette.ts`), and its CLI
  command in the page header.
- **A new action:** a dialog in `components/service-actions.tsx` that names its
  target and says what will happen; follow its operation with
  `OperationLog`; toast the command.
- **Something the API does not have:** the Forge API grows it first, and the
  CLI gets it too. After it is merged there, sync the protos:
  `sh scripts/sync-proto.sh ../forge`.
- **Show only what Forge knows.** No numbers, stages or warnings the API cannot
  back.

## Ship it

Open a pull request. CI tests it once; the tests do not run again after the
merge, so the branch must contain the current `main` before it merges.

On `main`, CI builds `ghcr.io/showmino/forge-web:<short-sha>` and deploys that
commit to staging through Forge, as a release candidate (`v0.1.8-rc.1`).
Production is the owner's promote, which makes it the final version
(`v0.1.8`):

```sh
forge deploy status forge-web
forge deploy promote forge-web
forge env create <name> --service forge-web --ref <branch>   # a preview
```

## These docs

They are Markdown under `docs/`, read by Forge from `main` and shown in the
dashboard; [Writing docs](writing-docs.md) says what works. Add a page to the
`docs:` list in `forge.yaml` to put it in the side menu. Check them before a
push:

```sh
forge docs lint
forge docs get forge-web --pages
```
