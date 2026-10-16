# Using the dashboard

A tour of every page, what it shows, and the command that does the same from
the terminal. Press **Ctrl+K** (**⌘K** on a Mac) anywhere to jump to a page,
a service or a preview by typing part of its name.

## Overview

`/` answers three questions: what is shipping, what is broken, and what needs
you.

- **The numbers of the day**: services in the catalog, deploys today, how many
  finished deploys failed, previews alive. They come from the audit log, so a
  restart of Forge does not reset them.
- **In flight**: deploys running now, followed live, with the stage each is at
  (image, release, commit, namespace, sync). Building and testing happen in the
  service's CI before Forge is asked.
- **Needs attention**: deployments Argo CD does not call healthy, deploys that
  failed in the last day, and previews that failed or end within six hours.
- **Recent deploys**: what ended in the last 24 hours.

Same from the terminal: `forge deploy status`.

## Services

`/services` is the catalog: every service, its team, its lifecycle and how
staging and production are doing. Filter by name or pick a team.
`forge service list`

A service's page (`/services/<name>`) has tabs:

| Tab | What it shows |
| --- | --- |
| Overview | Staging and production (status, version, commit, who deployed, address), previews, recent activity, the facts about the service |
| Deployments | What was deployed to staging and production, newest first |
| Dependencies | The services it depends on, and the ones that depend on it |
| Docs | The service's docs, when its repo has `docs/index.md` |
| Settings | For the service's team and admins: the contacts and the lifecycle; for admins also the owning team, the address and Delete |

The members of the service's team (and admins) deploy, promote and roll back
from the top of the page and from the
Staging and production table. Every action asks first, names what it will do,
and then shows the work live until it ends.

`forge service get <name>`, `forge deploy history <name> --env staging`,
`forge service update <name> --lifecycle production`

## Templates and Create

`/templates` lists what a new service can start from (`go-grpc`, `nextjs`),
with the parameters each asks for. **Create service** (`/create`) makes the
GitHub repository, its CI and the catalog entry, and shows the command it is
the same as while you fill in the form.
`forge template list`, `forge create <name> --template nextjs --team <team>`

## Docs

`/docs` lists every service that has docs; `/docs/<service>/<page>` reads one
page, with the other pages on the left and the headings of this one on the
right. **Edit on GitHub** opens the page's file. Docs change here within a
minute of reaching the default branch. To give a service docs, see
[Writing docs](writing-docs.md).
`forge docs list`, `forge docs get <service> runbook.md`

## Environments

`/environments`: how staging and production are doing across the catalog,
and every preview with the time it has left. A preview runs one branch of a
service at its own address until its time is up; the members of the
service's team create, extend and destroy them here or on the service's page.
`forge env list`, `forge env create <name> --service <service> --ref <branch>`

## Deployments and Operations

- `/deployments`: deploys, promotions and rollbacks of the last 7 days, with
  the stage each reached and who started it. Filter by in progress, failed,
  succeeded.
- `/operations`: all long-running work, including creating a service, previews
  and deletes. Open one to follow it live or cancel it.

`forge op list`, `forge op watch <id>`

## Ownership

`/ownership`: which GitHub team owns which service. It points out services
whose team is not a team on GitHub, services with no contacts, and teams with
no services. An admin moves a service to another team from its Settings.
`forge team list`

## Audit log

`/audit`: every action taken through Forge, from the CLI, the dashboard or CI:
who, what, on which service, and how it ended. Filter by service, person,
action, or failures only.
`forge audit list --service <name> --since 7d`
