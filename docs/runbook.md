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

## Who to ask

platform-engineering, the owning team.
