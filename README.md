# forge-web

Owned by **platform-engineering**. Scaffolded by `forge create` from the
`nextjs` template (v1.3.1): a server-rendered
Next.js app with TypeScript and Tailwind CSS.

## What it is

The web dashboard of Forge: the catalog, a page per service, the templates,
environments, deployments, operations, ownership and the audit log. The
members of a service's team (and an admin) also deploy, promote, roll back,
manage previews and change its contacts and lifecycle from it; a member of
any team creates a service of their team from a template, from an image
someone else built, or from a published Helm chart (no repo: the API keeps its
`forge.yaml` in the deploy repo, and the page then deploys it to staging, as
`forge create --image` and `--chart` do);
moving a service to
another team, its address and deleting it are an admin's. Each is behind a
confirmation, with the work shown live (`WatchOperation`) and a toast that
names the CLI command. It is a thin client of the Forge API, like the CLI: every call
goes from the browser to forge-api with the reader's own token, and the API
decides what they may see and do. The dashboard asks it which actions the
caller may do (`AuthService.TestPermissions`, per service, through
`usePermissions` in `components/app-shell.tsx`) only to hide the buttons of
the others. The server only serves the pages and
`/api/healthz`; it holds no secrets.

- **Home** (`/`): what Forge is for, with the actions the caller's role
  allows (create, deploy, templates, docs); four numbers (services, or the
  caller's team's; deploys today and their success rate; what needs the
  caller; production's health); "Services that need a look first" (an
  admin's and a reader's) or "Your services" (a team member's: the services
  whose `owner_team` is one of their teams), each where it hurts most
  (`lib/catalog.ts`); "Needs you" or, when nothing does, "Get started"; then
  recent activity, the platform's status and quick links. The numbers of the
  day and the recent deploys come from the audit log of the last 24 hours,
  which outlives a restart of the API. "Needs you" is first the production
  runs of infrastructure repos that wait for the caller's team (pending
  approvals whose `owner_team` is one of the caller's teams, an admin's too:
  only the owning team is told; `lib/approvals.ts`), then deployments Argo
  CD does not call healthy, deploy targets whose last deploy failed, and
  previews that failed or end within six hours; a team member sees only
  their team's. The rail counts those waiting runs beside Approvals (a dot
  on the narrow rail). The dashboard does not know the caller's GitHub user,
  so a run they started themselves is counted too: the text says "your
  team's approval".
- **Catalog** (`/services`): tabs for services, templates, resources and,
  for admins, clusters (`components/catalog-tabs.tsx`); search, filters for
  the owner and the status (needs attention, healthy, ready to promote), and
  one table with the environment where each service hurts most, broken
  first. **Resources** (`/resources`) lists every resource of every service
  (`ListResources`); plans and applies stay on a service's Resources tab.
- **Deployments** (`/deployments`): the day in four numbers (deploys, the
  success rate, the median duration of the successful ones, failures), then
  every deploy, promotion and rollback running now or ended in the last 7
  days, with search and filters for the service, the environment and the
  status, and the details of the one picked. A duration is the time from
  the request to the outcome in the audit log (`lib/deployments.ts`). The
  stage line shows Forge's own steps (image, release, commit, namespace,
  sync): building and testing happen in the service's CI before Forge is
  asked.
- **A service** (`/services/<name>`) has tabs: Overview (cards: the service
  in facts, its resources and dependencies, staging and production, recent
  activity and previews), Deployments
  (`ListDeployHistory` of both environments), Resources (once it has a
  resource or a plan: its databases with live health, `ListResources`, and
  its newest plans with their changes and policy result,
  `ListResourcePlans`; Apply on a ready plan, for its team in staging and
  admins in production, asks for a database's name before deleting it, as
  `forge resource apply` does; plans are made from forge.yaml by the CLI or
  the service's CI, not here), Dependencies (what it depends
  on, and what in the catalog depends on it) and, for the service's team and
  admins, Settings (the gear button too): the owning team (an admin's only),
  the contacts and the lifecycle,
  saved with `UpdateService` and the etag the page read, so a change someone
  made meanwhile is refused, not overwritten. Delete and Change address are
  in its danger zone, for admins.
  A link to `#settings` opens that tab.
- **Environments** (`/environments`): staging and production across the
  catalog (how many services run there, which are not healthy, deploys
  today) and every preview with the time it has left. A member of a team
  creates a preview from here, and extends or destroys those of the team's
  services.
- **Deployments** (`/deployments`): deploys, promotions and rollbacks of the
  last 7 days from the audit log, and the running ones from the operations.
  `/operations` stays: it also lists creates, previews and deletes.
- **Approvals** (`/approvals`): the production runs of infrastructure repos
  (Forge phase 12, `ApprovalService`) waiting for an approval, and all of
  them; Approve and Reject ask for a reason, and the API refuses the person
  who pushed the commit or started the run unless the repo's team has an
  exception. An approved run Forge could not start shows "Run not started"
  and can be started again. Below: the exceptions and whether each holds
  (hidden on a Forge without them), each with Revoke for its team or an
  admin. An infrastructure repo's own page shows
  its target, environments and exception instead of deploys, with "Ask for
  an exception" or "Revoke exception" for its team or an admin (a repo with
  production only; `RequestException` and `RevokeException` open a pull
  request in the deploy repo, which the dialog links), an Approvals
  tab instead of Deployments, and no Deploy, Promote or Preview buttons. A
  repo that also has an app (`infrastructure.runs`, from a template such as
  `nextjs-infra`) shows a service's page, with deploys, previews and
  promote, and adds the infrastructure to its overview and an Approvals tab.
  A service has staging, production or both (`Service.environments`; empty
  is both): its page shows only those, Deploy goes to its one environment
  when it has one, Promote needs both, Settings changes them (not an
  infrastructure repo's), and the danger zone takes a deployed environment
  down for its team (`DeleteDeployment`). The Create page asks every kind of
  service for its environments (both ticked).
  The Create page asks an infrastructure template for a target
  (`TemplateService.ListTargets`, those open to the team) and its
  environments; one that offers run options asks for those too, and for who
  can reach the app.
- **Ownership** (`/ownership`): the organization's teams (`TeamService`)
  joined with the catalog: which team owns which service, each team's
  members and on-call rotation, services whose team is not a team on GitHub,
  services with no contacts, teams with no services and teams that own
  services but page nobody. An admin sets a team's on-call there
  (`TeamService.UpdateTeam`); the home page tells an admin about a team
  without one. A service's tier and SLO target show in the Catalog (with a
  Tier filter) and on its page, and its team changes them in Settings.
  A service's page has a golden-path card: how many of its checks pass (CI,
  SLO, tracing, runbook, on-call; `ServiceCatalogService.ListServiceChecks`)
  and what to do about each missing one. The Catalog's status filter "Off the
  golden path" keeps the services that miss one (`?status=offpath`).
- **Rules** (`/rules`): the production runs waiting for the caller's team,
  then every rule Forge checks (`PolicyService.ListRules`), by kind. An admin
  switches a switchable rule between enforce, warn and off
  (`UpdateRule`); the rules that guard Forge are listed as always enforced.
- **Clusters** (`/clusters`, admins only): the cluster Forge runs on
  (`ClusterService`) with its status and how much CPU, memory and disk is in
  use; `/clusters/<name>` adds the pods, every node with its condition, and
  every persistent volume tied to its service. The rail shows the link to
  admins only, and the API refuses everyone else. Disk and volumes need
  forge-api's `--prometheus-url`; without it the page says so.
- **Jump to** (top bar, Ctrl+K or ⌘K): a command palette over the pages,
  the services and the previews.
- **Create service** (top bar, beside the theme switch): on every page except
  the Create pages, for whoever may create a service; the plus alone at phone
  width.
- **Docs** (`/docs`, and a Docs tab on a service that has docs): a service's
  Markdown under `docs/` in its repo, read through `DocsService` (Forge's
  TechDocs). `/docs/<service>/<path>` is one page: the pages on the left, the
  page in the middle, its headings on the right, with the commit it was read
  at and "Edit on GitHub". `components/doc-reader.tsx` renders it with
  react-markdown (GitHub tables, task lists, footnotes, highlighted code with
  a copy button).
  Raw HTML in a page is shown as text, never run; links between pages stay in
  the dashboard; images come through `GetDocAsset` as `data:` URLs (the repos
  are private, and the Content-Security-Policy allows no other site); an
  image from another site is not loaded. Heading ids start with `doc-`, so a
  page never takes an id the dashboard uses.
- **Login:** the authorization code flow with PKCE against Forge's login
  service, as the public client forge-api names in `GetServerInfo`
  (`lib/auth`). Right after the sign-in the page trades the ID token for a
  Forge session (`AuthService.CreateSession`): a token of forge-api's own
  that lasts 7 days, kept in `localStorage` so every tab shares it, and ended
  on the API by Sign out. There is no refresh token. Against an API that
  keeps no sessions, the ID token lives in the tab's `sessionStorage` for an
  hour, as before.
- **Delete:** an admin deletes a service from the danger zone of its
  settings. The name is typed to
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
  (https://claude.ai/artifact/JH9WMXofSHtUrQcGB5AwfG; the owner's later
  mockup is `docs/design/forge-console.html`, sample data only): a dark iron rail beside
  a light work surface, ember for the one primary action and for work in
  progress, status pills with a dot and a word, names in mono, and on every
  page the CLI command that does the same. Its tokens are the Tailwind theme
  in `app/globals.css`; its parts are in `components/ui` and
  `components/app-shell.tsx`. Every page follows the design's layout for
  it: Services, a service, Templates (cards), Docs, Environments, Deployments,
  Operations, Ownership, the Audit log and Create (in steps: template,
  details, visibility, runtime, review; the whole command is shown beside
  every step as the form is filled in). Create's first step also chooses
  where to start: from a template, or from an image, which skips the
  template inputs and may set every run option, and the folders it writes
  besides `/tmp` (`run.writable`). Or from a repo of the organization (`forge service
  connect`): Repo, Name and owner, Review; the API registers the service and
  opens a pull request in the repo, and the page ends with it. Or from a
  Helm chart (`forge create --chart`): Chart (repository, name, version,
  the Service that gets the address, values for every environment and
  production's), Name and owner, Review. A service without a repo
  deploys an image tag (or, for a chart, a chart version) instead of a
  branch and has no previews. What the mockup shows that Forge
  does not know is left out: rules and approvals, the golden path, tiers
  and SLOs, team members and on-call, template lint. The Docs page searches
  every service's pages (`SearchDocs`, forge-api with TechDocs milestone 3).
  The mockup's Overview is the page as it is built here. The service
  databases Phase 5 brought are on the service's Resources tab.

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
`web.allowedOrigins`. Set `FORGE_API_URL` for another API.

The tests render each page against an in-memory Forge API
(`app/pages.test.tsx`); none needs a network.

The image runs the standalone server (`node .next/standalone/server.js`); `npm start` (`next start`) warns with standalone output but still serves locally.

## Ship

CI tests every pull request, once: the tests do not run again after the merge.
On `main` it builds and pushes `ghcr.io/showmino/forge-web:<short-sha>`, then
a `deploy` job deploys that commit to staging through Forge
(`https://forge-staging.showmino.com`, `run.host: forge`). It logs in
with the job's GitHub OIDC token, and needs the organization variable
`FORGE_API_URL`. The image has no API address built in: the server reads
`FORGE_API_URL` when it starts and puts it into each page, so the same image
serves any Forge.

Production is not this service: every Forge runs the dashboard from the
`forge` chart, at the version its `web.image.tag` names. Never promote the
forge-web service: its production address would be `forge.showmino.com`, the
chart's. To ship a change:

1. Merge it, and check it on staging.
2. Push a tag on that commit of `main`:
   `git tag v0.1.36 <commit> && git push origin v0.1.36`. `release.yml` gives
   that commit's image the version: `ghcr.io/showmino/forge-web:v0.1.36`.
3. showmino's install: a pull request in `showmino/kubernetes` that sets
   `web.image.tag: v0.1.36` in `apps/helm/forge/production/app.yaml`, with the
   render, `kubectl diff` and a server dry run. Merging it (the owner) is the
   rollout: Argo CD restarts the dashboard pod.
4. Every other Forge: bump `web.image.tag` in `showmino/forge`'s
   `deploy/platform/chart/values.yaml`, which ships with the next chart
   release.

- `forge deploy status forge-web --env staging`: what staging runs.
- `forge env create <name> --service forge-web --ref <branch>`: a preview of
  a branch with its own URL.

The server listens on `$PORT` (`run:` in `forge.yaml`). In Forge the root
filesystem is read-only, and Next's cache (`.next/cache`) is a link to the
writable `/tmp`.

## Docs

`docs/` holds this service's docs for readers of Forge: an overview, a tour of
the dashboard, how to write docs for any service, how it is built, its
security, how to work on it, and a runbook, in the order `docs:` in
`forge.yaml` gives. Forge reads them from `main` (`forge docs get forge-web
runbook.md`). Check them with `forge docs lint` before a push, and keep them
true in the same pull request as the change they describe.

## License

Apache License 2.0: see [LICENSE](LICENSE).
