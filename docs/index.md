# Forge dashboard

forge-web is the web dashboard of Forge, the `showmino` internal developer
platform. It shows the catalog, every service's staging, production and
previews, deployments, operations, ownership and the audit log, and lets a
writer create, deploy, promote, roll back and manage previews from the
browser.

| | |
| --- | --- |
| Production | <https://forge.showmino.com> |
| Staging | <https://forge-staging.showmino.com> |
| Owner | platform-engineering |
| Repository | [showmino/forge-web](https://github.com/showmino/forge-web) |
| The platform | [showmino/forge](https://github.com/showmino/forge) |

## What it is

A Next.js app and a thin client of the Forge API. Every call goes from the
browser to forge-api with the reader's own session token, and the API decides
what they may see and do; a reader who is not a writer simply gets fewer
buttons. The server only serves the pages and `/api/healthz`: it holds no
secrets and has no endpoints of its own. If the dashboard needs something, the
Forge API grows it, and the CLI gets it too.

Every page names the `forge` command that does the same thing from the
terminal.

## Pages

- [How it is built](architecture.md): login, sessions, the API client, the
  Content-Security-Policy.
- [Working on it](development.md): run it locally, test it, ship it.
- [Runbook](runbook.md): what to do when it breaks.
