# How it is built

## Login and sessions

Login is the authorization code flow with PKCE against Forge's login service
(Dex, with GitHub behind it), as the public client forge-api names in
`GetServerInfo` (`lib/auth`). Only members of `showmino` get in; writing needs
the team `platform-engineering`.

Right after the sign-in the page trades the ID token for a Forge session
(`AuthService.CreateSession`): a token of forge-api's own (`fgs_…`) that lasts
7 days. It is kept in `localStorage`, so every tab shares it, and ended on the
API by Sign out. There is no refresh token. A sign-out in one tab signs out
every tab.

## The API client

`gen/` is generated from the protos in `proto/`, a copy from `showmino/forge`
at the commit in `proto/FORGE_COMMIT`. After an API change:

```sh
sh scripts/sync-proto.sh ../forge
```

Pages are client components behind the login gate (`components/app-shell.tsx`)
and read with TanStack Query. Long work (deploys, previews, deletes) is
followed live with `WatchOperation`, which reconnects when the stream drops.
Errors say what went wrong and what to do next (`errorText` in `lib/api.ts`).

## Security headers

`proxy.ts` sets the Content-Security-Policy on every page (`lib/csp.ts`):

- Scripts run only with the nonce of their request: the framework's own, the
  one line that sets the theme before the first paint, and what those load.
  An inline script that got into a page any other way does not run. This is
  what protects the session kept in the browser.
- A nonce is per request, so every page is rendered on request; nothing is
  prerendered.
- `connect-src` names forge-api and the login service only.

Never add `'unsafe-inline'` to `script-src`.

## The look

The Forge Console design: a dark iron rail beside a light work surface, ember
for the one primary action and for work in progress, status pills with a dot
and a word, names in mono. Its tokens are the Tailwind theme in
`app/globals.css`; its parts are in `components/ui`. Fonts are files in
`app/fonts`, so a build fetches nothing from the internet but npm packages.
