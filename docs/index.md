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
terminal, with a Copy button beside it.

## Who can do what

| You are | You can |
| --- | --- |
| A member of `showmino` | Sign in and read everything: services, deployments, previews, docs, the audit log |
| In the team `platform-engineering` (a writer) | Also create services, deploy, promote, roll back, manage previews, change a service's settings, delete a service |

The buttons follow what the API says you may do; the API still checks every
call.

## In these docs

| Page | For | What is in it |
| --- | --- | --- |
| [Using the dashboard](using.md) | everyone | Every page, what it shows and the command that does the same |
| [Writing docs](writing-docs.md) | every service team | How to give a service docs that show here |
| [How it is built](architecture.md) | people who change it | The parts, how data flows, how pages are rendered |
| [Security](security.md) | people who change it | Sessions, the Content-Security-Policy, untrusted content |
| [Working on it](development.md) | people who change it | Run it, test it, ship it |
| [Runbook](runbook.md) | whoever is on call | What to do when it breaks |
