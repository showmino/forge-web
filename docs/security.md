# Security

The dashboard holds a session that can deploy to production. Everything here
exists to keep a stranger's script from reading it.

## What the server holds

Nothing secret. The Next.js server serves pages and `/api/healthz` and has no
endpoints of its own. Every call goes from the browser to forge-api with the
reader's token, and forge-api decides. `NEXT_PUBLIC_*` values are public by
design; no secret belongs in the repo or the image.

## Sign-in and the session

- Sign-in is the authorization code flow with PKCE against Forge's login
  service (Dex with GitHub behind it). Only members of `showmino` get in.
- The ID token is traded at once for a Forge session (`fgs_…`) that lasts
  7 days. There is no refresh token.
- The session is kept in `localStorage`, shared by every tab. Sign out ends it
  on the API as well, and in every tab.
- Forge checks every session's person against GitHub every hour: someone who
  leaves the organization loses the session, and leaving or joining the writer
  team changes what it may do.

## The Content-Security-Policy

`proxy.ts` sets it on every page (`lib/csp.ts`):

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | Only scripts with this request's nonce run, and what they load |
| `style-src` | `'self' 'unsafe-inline'` | React sets style attributes; a style cannot read the session |
| `img-src` | `'self' data:` | Docs images arrive as `data:` URLs from the API |
| `connect-src` | forge-api and the login service | Nowhere else to send anything |
| `frame-ancestors` | `'none'` | The dashboard cannot be framed |

Because the nonce is per request, every page is rendered on request; nothing is
prerendered. Never add `'unsafe-inline'` to `script-src`, and give any inline
`<script>` the nonce from the layout.

## Content the dashboard does not trust

Docs pages are written by anyone who can push to a service's repo. The reader
(`components/doc-reader.tsx`):

- shows raw HTML as text and never runs it (react-markdown without
  rehype-raw);
- drops `javascript:` and other unsafe links before they are drawn;
- shows only png, jpeg, gif and webp images, fetched through the API; no SVG,
  nothing from another site;
- prefixes every heading id with `doc-`, so a page cannot take an id the
  dashboard uses.

Names, messages and errors from the API are rendered as text by React, never
as HTML.

## Changes that need a second look

A change to the login, the session, the Content-Security-Policy, or anything
a stranger's input reaches gets one independent review before it merges.
