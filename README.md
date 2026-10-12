# forge-web

Owned by **platform-engineering**. Scaffolded by `forge create` from the
`nextjs` template (v1.3.1): a server-rendered
Next.js app with TypeScript and Tailwind CSS.

## What it is

The web dashboard of Forge: the catalog, a page per service, the templates,
operations and the audit log. A writer also creates a service from a template,
deploys, promotes, rolls back and manages previews from it, each behind a
confirmation, with the work shown live (`WatchOperation`). It is a thin client of the Forge API, like the CLI: every call
goes from the browser to forge-api with the reader's own token, and the API
decides what they may see and do. The server only serves the pages and
`/api/healthz`; it holds no secrets.

- **Overview** (`/`): what is shipping, what is broken and what needs
  someone. The numbers of the day and the recent deploys come from the audit
  log of the last 24 hours, which outlives a restart of the API; what is in
  flight is followed live; "needs attention" is deployments Argo CD does not
  call healthy, deploy targets whose last deploy failed, and previews that
  failed or end within six hours. The stage line shows Forge's own steps
  (image, release, commit, namespace, sync): building and testing happen in
  the service's CI before Forge is asked. The services list is at
  `/services`.
- **Login:** the authorization code flow with PKCE against Forge's login
  service, as the public client forge-api names in `GetServerInfo`
  (`lib/auth`). Right after the sign-in the page trades the ID token for a
  Forge session (`AuthService.CreateSession`): a token of forge-api's own
  that lasts 7 days, kept in `localStorage` so every tab shares it, and ended
  on the API by Sign out. There is no refresh token. Against an API that
  keeps no sessions, the ID token lives in the tab's `sessionStorage` for an
  hour, as before.
- **Delete:** a writer deletes a service from its page. The name is typed to
  confirm, as on the CLI; the API then takes down everything the service
  runs (previews, staging, production, their namespaces) and removes it from
  the catalog, shown live. The GitHub repo is kept. This needs a forge-api
  with the teardown (showmino/forge#28): an older API removes only the
  catalog entry.
- **Security headers:** `proxy.ts` sets the Content-Security-Policy on every
  page (`lib/csp.ts`). Scripts run only with the nonce of their request: the
  framework's own, the one line in the layout that sets the theme, and what
  those load. An inline script or event handler that got into a page some
  other way does not run, which is what protects the session kept in the
  browser. A nonce is per request, so every page is rendered on request
  (the layout reads `x-nonce`); nothing is prerendered. `connect-src` names
  forge-api and the login service only: the proxy asks forge-api which login
  service it uses, and until the API has answered it allows any web address,
  so a failed lookup never locks a reader out. Styles may be inline. Also sent:
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- **Fonts:** Archivo, IBM Plex Sans and IBM Plex Mono are files in the repo
  (`app/fonts`, Latin subsets from the Fontsource packages, SIL Open Font
  License, licences beside them), loaded with `next/font/local`. A build
  fetches nothing from Google.
- **Owner:** a service is owned by a team of the GitHub organization. Create
  picks it from the teams the API lists from GitHub (`TeamService`); if the
  list cannot be read it says why and lets the team be typed.
- **API client:** `gen/` is generated from the protos in `proto/`, a copy from
  `showmino/forge` at the commit in `proto/FORGE_COMMIT`. After an API change:
  `sh scripts/sync-proto.sh ../forge`.
- **Look:** the Forge design language of the Forge Console design
  (https://claude.ai/artifact/JH9WMXofSHtUrQcGB5AwfG): a dark iron rail beside
  a light work surface, ember for the one primary action and for work in
  progress, status pills with a dot and a word, names in mono, and on every
  page the CLI command that does the same. Its tokens are the Tailwind theme
  in `app/globals.css`; its parts are in `components/ui` and
  `components/app-shell.tsx`. Every page follows the design's layout for
  it: Services, a service, Templates (cards), Operations (the design's
  Deployments table and chips), the Audit log and Create (with the whole
  command shown as the form is filled in).

## Develop

```sh
npm ci
npm run dev        # http://localhost:3000, calls the API at http://localhost:8080
npm run lint && npm run typecheck && npm test
npm run build      # standalone server in .next/standalone
```

Locally the API must accept the dashboard: start forge-api with
`--oidc-web-client-id forge-web --cors-origins http://localhost:3000`, and give
its Dex a public client `forge-web` with the redirect URI
`http://localhost:3000/auth/callback` and `http://localhost:3000` in
`web.allowedOrigins`. Set `NEXT_PUBLIC_FORGE_API_URL` for another API.

The tests render each page against an in-memory Forge API
(`app/pages.test.tsx`); none needs a network.

The image runs the standalone server (`node .next/standalone/server.js`); `npm start` (`next start`) warns with standalone output but still serves locally.

## Ship

CI tests every push. On `main` it pushes
`ghcr.io/showmino/forge-web:<short-sha>`, then a `deploy`
job deploys that commit to staging through Forge. It logs in with the job's
GitHub OIDC token, and needs the organization variable `FORGE_API_URL`.
The image build also takes that address (`NEXT_PUBLIC_FORGE_API_URL`): the
pages call the API from the browser, so it is built into them.

- `forge deploy status forge-web`: what runs where.
- `forge deploy promote forge-web`: staging to production.
- `forge env create <name> --service forge-web --ref <branch>`: a
  preview with its own URL.

The server listens on `$PORT` (`run:` in `forge.yaml`). In Forge the root
filesystem is read-only, and Next's cache (`.next/cache`) is a link to the
writable `/tmp`.
