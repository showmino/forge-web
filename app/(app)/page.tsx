"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePermissions, useRole, useWaitingApprovals } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { ExtendDialog } from "@/components/service-actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorNote, Loading } from "@/components/ui/layout";
import {
  Activities,
  type Activity,
  Card,
  CardNote,
  Chip,
  ct,
  ctd,
  cth,
  Health,
  LinkList,
  Mark,
  type Need,
  Needs,
  ServiceName,
  Stat,
  StatusLines,
  Stats,
  Steps,
  wide,
} from "@/components/ui/portal";
import { StatusBadge } from "@/components/ui/status";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { lastDay, listAllServices, serviceId } from "@/lib/api";
import { approvalAttention } from "@/lib/approvals";
import { type CatalogRow, catalogRows, newThisWeek } from "@/lib/catalog";
import { clusterStatus } from "@/lib/cluster";
import { timeAgo } from "@/lib/format";
import { ownership } from "@/lib/ownership";
import { attention, type Attention, board, type BoardRow, dayStats, expiringSoon, recentDeploys, type RecentDeploy } from "@/lib/overview";
import type { Tone } from "@/lib/status";

const mono = "font-mono text-[0.92em] font-medium";

// Home: what Forge is for and the actions the person may take, four
// numbers, the services they care about and what needs them, then activity,
// the platform's status and where to go next. What each card holds depends
// on the person's role: an admin sees all of Forge, a team member their
// team's services, a reader everything but the actions.
export default function Home() {
  const api = useApi();
  const queries = useQueryClient();
  const role = useRole();
  const [extending, setExtending] = useState<Environment | null>(null);

  const status = useQuery({ queryKey: ["status"], queryFn: () => api.auth.getStatus({}), staleTime: 5 * 60_000 });
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
    refetchInterval: 30_000,
  });
  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: () => api.environments.listEnvironments({}).then((r) => r.environments),
    refetchInterval: 30_000,
  });
  const running = useQuery({
    queryKey: ["operations", "running"],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
    refetchInterval: 5_000,
  });
  const audit = useQuery({ queryKey: ["audit", "last-day"], queryFn: () => lastDay(api), refetchInterval: 30_000 });
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api.clusters.listClusters({}).then((r) => r.clusters),
    refetchInterval: 60_000,
    retry: false,
  });
  const teamList = useQuery({ queryKey: ["teams"], queryFn: () => api.teams.listTeams({}).then((r) => r.teams), retry: false });
  const waiting = useWaitingApprovals();
  const canCreate = usePermissions().can("service.create");

  const teams = useMemo(() => status.data?.teams ?? [], [status.data]);
  const rows = useMemo(() => catalogRows(services.data ?? [], deployments.data ?? []), [services.data, deployments.data]);
  const mine = useMemo(() => rows.filter((r) => teams.includes(r.team)), [rows, teams]);
  const recent = useMemo(() => recentDeploys(audit.data ?? []), [audit.data]);
  const day = useMemo(() => dayStats(audit.data ?? []), [audit.data]);
  const boards = useMemo(() => (deployments.data ? board(deployments.data, services.data?.length) : undefined), [deployments.data, services.data]);
  const needs = useMemo(() => {
    const all = [...approvalAttention(waiting), ...attention(deployments.data ?? [], environments.data ?? [], recent)];
    // An admin also hears of the teams that own services but page nobody.
    if (role === "Admin" && teamList.data && services.data) {
      for (const slug of ownership(services.data, teamList.data, []).noOncall) {
        const n = services.data.filter((s) => s.ownerTeam === slug).length;
        all.push({
          key: `oncall-${slug}`,
          tone: "warning",
          before: "",
          subject: slug,
          after: " has no on-call rotation",
          detail: `${n} service${n === 1 ? "" : "s"}, and nobody is paged when they break`,
          href: "/ownership",
        });
      }
    }
    // A team member sees what is wrong with their team's services; an admin and a reader all of it.
    if (role !== "Team") return all;
    const own = new Set(mine.map((r) => r.id));
    return all.filter((a) => a.key.startsWith("approval-") || own.has(a.subject) || (a.extend && own.has(serviceId(a.extend.service))));
  }, [waiting, deployments.data, environments.data, recent, role, mine, teamList.data, services.data]);

  const broken = services.error ?? deployments.error;
  const loading = services.isPending || deployments.isPending;
  const team = teams[0];
  const okPct = day.finished ? Math.round((100 * (day.finished - day.failed)) / day.finished) : 100;
  const fresh = newThisWeek(services.data ?? []);
  const prod = boards?.find((b) => b.env === "production");
  const shown = role === "Team" ? mine : rows.slice(0, 6);

  return (
    <div className="flex flex-col">
      <Hero role={role} canCreate={canCreate} team={team} />

      <div className="mt-6 flex flex-col gap-4">
        <Stats label="At a glance">
          {role === "Team" ? (
            <Stat icon="box" label="Your team's services" value={services.data ? mine.length : "…"} chip={services.data ? `of ${rows.length}` : undefined} />
          ) : (
            <Stat icon="box" label="Services" value={services.data ? rows.length : "…"} chip={fresh ? `+${fresh} this week` : undefined} tone="success" />
          )}
          <Stat
            icon="ship"
            label="Deploys today"
            value={audit.data ? day.started : "…"}
            chip={audit.data ? `${okPct}% success` : undefined}
            tone={okPct >= 90 ? "success" : okPct >= 70 ? "warning" : "danger"}
          />
          <Stat
            icon="bell"
            label={role === "Admin" ? "Need a decision" : role === "Team" ? "Need you" : "Open problems"}
            value={loading ? "…" : needs.length}
            chip={loading ? undefined : needs.length ? (waiting.length ? `${waiting.length} approval${waiting.length === 1 ? "" : "s"}` : "See below") : "All clear"}
            tone={needs.length ? "warning" : "success"}
          />
          <ProductionStat row={prod} />
        </Stats>

        {broken ? <ErrorNote error={broken} /> : null}

        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 max-[980px]:grid-cols-1">
          <Card icon="box" title={role === "Team" ? "Your services" : "Services that need a look first"} more={{ href: "/services", label: "View catalog" }}>
            {loading ? (
              <Loading what="services" />
            ) : shown.length === 0 ? (
              <CardNote>{role === "Team" ? "Your team has no services yet." : "No services yet."}</CardNote>
            ) : (
              <ServiceTable rows={shown} />
            )}
          </Card>
          {needs.length > 0 ? (
            <Card icon="bell" title={role === "Admin" ? "Needs a decision" : role === "Team" ? "Needs you" : "Problems right now"} more={waiting.length ? { href: "/approvals", label: "Approvals" } : undefined}>
              {role === "Reader" ? <CardNote top>Their owners are on it. You can follow along, but not change anything.</CardNote> : null}
              <Needs label="Needs attention" max={5} items={needs.map((a) => needOf(a, setExtending))} />
            </Card>
          ) : (
            <GetStarted role={role} mine={mine} canCreate={canCreate} />
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[1200px]:grid-cols-2 max-[1200px]:[&>*:first-child]:col-span-2 max-[700px]:grid-cols-1 max-[700px]:[&>*:first-child]:col-span-1">
          <Card icon="pulse" title={role === "Team" ? "Your team's activity" : "Recent activity"} more={{ href: "/deployments", label: "View all" }}>
            {audit.error ? (
              <ErrorNote error={audit.error} />
            ) : audit.isPending ? (
              <Loading what="recent deploys" />
            ) : (
              <Activities
                label="Recent deploys"
                empty="No deploy has ended in the last 24 hours."
                items={(role === "Team" ? recent.filter((r) => mine.some((m) => m.id === r.service)) : recent).slice(0, 5).map(activityOf)}
              />
            )}
          </Card>
          <Card icon="gauge" title="Platform status" more={{ href: "/environments", label: "View status" }}>
            <StatusLines
              label="Platform status"
              items={[
                envLine("Production", prod),
                envLine("Staging", boards?.find((b) => b.env === "staging")),
                {
                  label: "Previews",
                  href: "/environments",
                  ...(environments.data
                    ? expiringSoon(environments.data) > 0
                      ? { tone: "warning" as Tone, word: `${environments.data.length} live, ${expiringSoon(environments.data)} ending soon` }
                      : { tone: "success" as Tone, word: `${environments.data.length} live` }
                    : { tone: "neutral" as Tone, word: "…" }),
                },
                {
                  label: "Deploy pipeline",
                  href: "/operations",
                  ...(running.data?.length ? { tone: "progress" as Tone, word: `${running.data.length} running` } : { tone: "success" as Tone, word: "Operational" }),
                },
                ...(clusters.data && clusters.data.length > 0 ? [clusterLine(clusters.data.filter((c) => clusterStatus(c).tone !== "success").length)] : []),
              ]}
            />
          </Card>
          <Card icon="link" title="Quick links">
            <LinkList
              label="Quick links"
              items={[
                { href: "/templates", icon: "layers", title: "Service templates", sub: "Starters for APIs, web apps and infrastructure" },
                { href: "/docs", icon: "book", title: "TechDocs", sub: "Guides, standards and runbooks" },
                role === "Admin"
                  ? { href: "/approvals", icon: "flag", title: "Approvals", sub: "Production runs that wait for a team" }
                  : { href: "https://forgegate.io/docs/install-and-login", icon: "term", title: "Forge CLI", sub: "Install it and log in", external: true },
                { href: "/ownership", icon: "help", title: "Support", sub: "Find the team that owns something" },
              ]}
            />
          </Card>
        </div>
      </div>

      {extending ? (
        <ExtendDialog
          environment={extending}
          onClose={() => setExtending(null)}
          onStarted={() => {
            setExtending(null);
            void queries.invalidateQueries({ queryKey: ["environments"] });
          }}
        />
      ) : null}
    </div>
  );
}

type Role = ReturnType<typeof useRole>;

// Hero says what Forge is for, with the actions the person's role allows.
function Hero({ role, canCreate, team }: { role: Role; canCreate: boolean; team: string | undefined }) {
  const big = "!px-[18px] !py-2.5 !text-[14.5px] gap-2.5";
  return (
    <section aria-labelledby="home-title" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6 pt-1 max-[980px]:grid-cols-1">
      <div>
        <div className="mb-2.5 flex items-center gap-1.5 text-[13px] text-fg-2">
          <span className="text-ember">
            <Mark name="rocket" size={13} />
          </span>
          Home
        </div>
        <h1 id="home-title" className="m-0 font-display text-[44px] leading-[1.05] font-[800] tracking-[-0.01em] [font-stretch:112%] max-[700px]:text-[32px]">
          Internal Developer Platform
        </h1>
        <p className="mt-3 mb-0 max-w-[62ch] text-[16px] text-fg-2 max-[700px]:text-[15px]">
          Build, deploy and run services on Forge. Self-serve templates, previews and guardrails for shipping safely.
        </p>
        <div className="mt-[22px] flex flex-wrap gap-3 max-[700px]:[&>*]:flex-[1_1_calc(50%-6px)] max-[700px]:[&>*]:justify-center max-[700px]:[&>*:first-child]:basis-full">
          {canCreate ? (
            <ButtonLink kind="primary" href="/create" className={big}>
              <Mark name="rocket" />
              Create a service
            </ButtonLink>
          ) : null}
          {role !== "Reader" ? (
            <ButtonLink href="/deployments" className={big}>
              <span className="text-fg-2">
                <Mark name="play" />
              </span>
              Deploy a change
            </ButtonLink>
          ) : null}
          <ButtonLink href="/templates" className={big}>
            <span className="text-fg-2">
              <Mark name="layers" />
            </span>
            {role === "Reader" ? "Browse templates" : "Open a template"}
          </ButtonLink>
          <ButtonLink href="/docs" className={big}>
            <span className="text-fg-2">
              <Mark name="book" />
            </span>
            Read the docs
          </ButtonLink>
        </div>
        <p className="mt-3.5 mb-0 text-[13px] text-fg-3">
          {role === "Admin" ? (
            <>
              As an <b>admin</b>, you can approve, create for any team and manage clusters.
            </>
          ) : role === "Team" ? (
            <>
              As a member of <span className="font-mono">{team}</span>, you can deploy and change your team&apos;s services.
            </>
          ) : (
            <>
              As a <b>reader</b>, you can view services, deploys and logs. Ask an admin to add you to a team to ship your own.
            </>
          )}
        </p>
      </div>
      <HeroArt />
    </section>
  );
}

// HeroArt is the stacked blocks of Forge's mark on a dotted ground. Decorative only.
function HeroArt() {
  return (
    <svg viewBox="0 0 260 170" aria-hidden="true" className="h-[170px] w-[260px] text-fg-3 max-[980px]:hidden">
      <defs>
        <pattern id="home-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.2" fill="currentColor" opacity=".18" />
        </pattern>
      </defs>
      <rect x="0" y="10" width="260" height="150" fill="url(#home-dots)" />
      <rect x="70" y="40" width="130" height="28" rx="5" fill="var(--line-strong)" />
      <rect x="70" y="76" width="86" height="28" rx="5" fill="var(--line-strong)" opacity=".8" />
      <rect x="70" y="112" width="46" height="28" rx="5" fill="var(--ember)" />
    </svg>
  );
}

function ProductionStat({ row }: { row: BoardRow | undefined }) {
  const [tone, word]: [Tone, string] = !row
    ? ["neutral", "…"]
    : row.running === 0
      ? ["neutral", "Not deployed"]
      : row.unhealthy
        ? ["danger", `${row.unhealthy} unhealthy`]
        : row.outOfSync
          ? ["warning", `${row.outOfSync} out of sync`]
          : ["success", "Healthy"];
  return <Stat icon="shield" label="Production" value={<Health tone={tone}>{word}</Health>} />;
}

function envLine(label: string, row: BoardRow | undefined): { label: string; href: string; tone: Tone; word: string } {
  const href = "/environments";
  if (!row) return { label, href, tone: "neutral", word: "…" };
  if (row.unhealthy) return { label, href, tone: "danger", word: `${row.unhealthy} unhealthy` };
  if (row.outOfSync) return { label, href, tone: "warning", word: `${row.outOfSync} out of sync` };
  if (row.running === 0) return { label, href, tone: "neutral", word: "Nothing deployed" };
  return { label, href, tone: "success", word: "Operational" };
}

function clusterLine(needLook: number): { label: string; href: string; tone: Tone; word: string } {
  return needLook
    ? { label: "Clusters", href: "/clusters", tone: "warning", word: `${needLook} need${needLook === 1 ? "s" : ""} a look` }
    : { label: "Clusters", href: "/clusters", tone: "success", word: "Operational" };
}

// ServiceTable is the home page's short list of services: where each hurts most.
function ServiceTable({ rows }: { rows: CatalogRow[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table aria-label="Services" className={ct}>
        <thead>
          <tr>
            <th className={cth}>Service</th>
            <th className={`${cth} ${wide}`}>Team</th>
            <th className={`${cth} ${wide}`}>Environment</th>
            <th className={cth}>Status</th>
            <th className={`${cth} ${wide}`}>Last deploy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={ctd}>
                <ServiceName id={r.id} />
              </td>
              <td className={`${ctd} ${wide}`}>{r.team ? <Chip>{r.team}</Chip> : <span className="text-fg-3">–</span>}</td>
              <td className={`${ctd} ${wide}`}>{r.env ? <Chip mono>{r.env === "production" ? "prod" : r.env}</Chip> : <span className="text-fg-3">–</span>}</td>
              <td className={ctd}>
                <StatusBadge status={r.status} />
              </td>
              <td className={`${ctd} ${wide} text-fg-3`}>{r.when || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// GetStarted is the path from nothing to production, when nothing needs the person.
function GetStarted({ role, mine, canCreate }: { role: Role; mine: CatalogRow[]; canCreate: boolean }) {
  const steps =
    role === "Reader"
      ? [
          { done: true, text: "Sign in to Forge", href: "/" },
          { done: false, text: "Find your team's owner", href: "/ownership" },
          { done: false, text: "Browse the service templates", href: "/templates" },
          { done: false, text: "Read the developer guide", href: "/docs" },
        ]
      : [
          { done: true, text: "Sign in to Forge", href: "/" },
          { done: mine.length > 0, text: "Create your first service", href: canCreate ? "/create" : "/templates" },
          { done: mine.some((r) => r.service && r.env !== ""), text: "Deploy to staging", href: "/deployments" },
          { done: mine.some((r) => r.env === "production"), text: "Promote to production", href: "/deployments" },
          { done: false, text: "Read the developer guide", href: "/docs" },
        ];
  return (
    <Card icon="rocket" title="Get started">
      <CardNote top>
        {role === "Reader" ? "You can look around everything. Join a team to ship your own changes." : "Nothing needs you right now. Here is the path from zero to production."}
      </CardNote>
      <Steps label="Get started" items={steps} />
    </Card>
  );
}

// needOf turns an attention item into a line of the "Needs you" card.
function needOf(a: Attention, extend: (e: Environment) => void): Need {
  return {
    key: a.key,
    tone: a.tone === "danger" ? "bad" : "warn",
    text: (
      <>
        <span className="what font-medium">{a.before}</span>
        <span className={mono}>{a.subject}</span>
        <span className="what font-medium">{a.after}</span>
      </>
    ),
    why: a.detail,
    action: <NeedAction item={a} onExtend={extend} />,
  };
}

function NeedAction({ item, onExtend }: { item: Attention; onExtend: (e: Environment) => void }) {
  // Only a preview is extended from here; its service decides who may.
  const canExtend = usePermissions(item.extend ? serviceId(item.extend.service) : undefined).can("environment.extend");
  if (item.extend && canExtend) {
    return (
      <Button size="sm" onClick={() => onExtend(item.extend!)} aria-label={`Extend ${item.subject}`}>
        Extend
      </Button>
    );
  }
  return (
    <ButtonLink size="sm" href={item.href} aria-label={`Open ${item.subject}`}>
      Open
    </ButtonLink>
  );
}

const verb = { deploy: "Deployed", promote: "Promoted", rollback: "Rolled back" };

function activityOf(r: RecentDeploy): Activity {
  const failed = r.pipeline.state === "failed";
  return {
    key: r.key,
    tone: failed ? "bad" : r.pipeline.state === "succeeded" ? "ok" : "run",
    ref: r.ref,
    text: (
      <>
        {failed ? "Failed " : `${verb[r.kind]} `}
        <span className="font-mono text-[0.95em]">{r.service}</span> <span className="text-fg-3">→ {r.env}</span>
      </>
    ),
    when: r.time ? timeAgo(r.time) : "",
  };
}
