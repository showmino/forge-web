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

## Test it

```sh
npm run lint && npm run typecheck && npm test   # what CI runs
npm run build
```

Pages are rendered in tests against an in-memory Forge API (Connect's router
transport), never a mock of `fetch`. Test data has the shapes of the live API
(`services/payments`, `templates/nextjs`). Write the test first.

Check a changed page at phone width, at 1440px, and in light and dark.

## Ship it

Open a pull request. CI tests it once; the tests do not run again after the
merge, so the branch must contain the current `main` before it merges.

On `main`, CI builds `ghcr.io/showmino/forge-web:<short-sha>` and deploys that
commit to staging through Forge, as a release candidate. Production is the
owner's promote:

```sh
forge deploy status forge-web
forge deploy promote forge-web
forge env create <name> --service forge-web --ref <branch>   # a preview
```

## These docs

They are Markdown under `docs/`, read by Forge from `main` and shown in the
dashboard. Check them before a push:

```sh
forge docs lint
forge docs get forge-web runbook.md
```
