# Runbook

## The dashboard does not load

1. Check what runs and whether Argo CD calls it healthy:

   ```sh
   forge deploy status forge-web
   ```

2. Check the health endpoint: `https://forge.showmino.com/api/healthz`
   (staging: `https://forge-staging.showmino.com/api/healthz`).
3. If a deploy broke it, roll back:

   ```sh
   forge deploy rollback forge-web --env production
   ```

## "The Forge API cannot be reached"

The pages call forge-api from the browser. Check
`https://forge-api.showmino.com/healthz`. If forge-api is down, the dashboard
cannot help: see `docs/agents/verifying.md` in `showmino/forge`.

## Sign-in fails

- **A redirect URI mismatch** at GitHub: the login's address and the GitHub
  OAuth app's callback URL disagree. Both must change together.
- **Back on the login page right after signing in:** the API refused the new
  token. Check that the account is a member of `showmino`.
- **Signed out in every tab:** a sign-out in one tab ends the session for all
  of them. That is intended.

## A page is blank or a script is blocked

The Content-Security-Policy refuses a script without the request's nonce. The
browser console names the blocked script. An inline `<script>` must get the
nonce from the layout; never add `'unsafe-inline'`.

## Buttons are missing

What a person may do on a service depends on their role toward it: a member
of the service's owning team deploys, promotes, rolls back, manages previews
and changes its settings; an admin (the team `platform-engineering`) also
moves it to another team, changes its address and deletes it; anyone else
only reads. The rail's foot says **Admin**, **Team** (in at least one team)
or **Reader**. Buttons follow `AuthService.TestPermissions` for each service.
A change of team takes effect within the hour, when Forge checks the session
against GitHub again.

## A deploy or promote is stuck

1. Open it on `/operations` (or `forge op watch <id>`) and read its last step.
2. A promote waits for Argo CD to call the new version healthy. If it does not,
   the step says why; cancel it with **Cancel** or `forge op cancel <id>`.
3. A staging deploy runs only after CI pushed the image. Check the repo's
   GitHub Actions run.

## Docs do not show, or show old text

- A change shows within a minute of reaching the default branch. Reload after
  that.
- "has no docs": the repo has no `docs/index.md`.
- A page missing from the side menu: with a `docs:` list in `forge.yaml`, only
  the listed pages are in it.
- An image does not show: images are png, jpeg, gif or webp up to 5 MiB, in
  `docs/`. SVG is never shown.
- From the terminal: `forge docs get forge-web --pages` reads what Forge sees.

## Going back

Every deploy of forge-web is a version. Roll production back to the one
before with:

```sh
forge deploy rollback forge-web --env production
```

and fix forward in a pull request.

## Who to ask

platform-engineering, the owning team.
