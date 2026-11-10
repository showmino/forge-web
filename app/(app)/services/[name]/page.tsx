"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { usePermissions } from "@/components/app-shell";
import { DocReader, DocsLink, useHasDocs } from "@/components/doc-reader";
import { GoldenPath } from "@/components/golden-path";
import { ExceptionDialog, useCanAskException } from "@/components/exception-actions";
import { OperationLog } from "@/components/operation-log";
import { ResourcesTab, useResources } from "@/components/resources";
import { useApi } from "@/components/providers";
import {
  ChangeAddressDialog,
  DeleteServiceDialog,
  DeployDialog,
  DestroyDialog,
  ExtendDialog,
  PreviewDialog,
  PromoteDialog,
  RemoveDeploymentDialog,
  RollbackDialog,
} from "@/components/service-actions";
import { ServiceSettings } from "@/components/service-settings";
import { Addr, Button, Icon, NameLink, TextLink } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Crumbs, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Card, CardNote, Chip, ct, ctd, cth } from "@/components/ui/portal";
import { catalogRows, tierStatus } from "@/lib/catalog";
import { EnvTag, Life, StatusBadge } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import type { Service } from "@/gen/forge/v1/catalog_pb";
import { type Deployment, Deployment_Health } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId, isCode, listAllServices, serviceEnvs, serviceId } from "@/lib/api";
import { START } from "@/lib/docs";
import { actorText, exact, isChartRef, shortCommit, timeUntil, when } from "@/lib/format";
import { approvalStatus, auditStatus, deploymentStatus, environmentStatus } from "@/lib/status";

type Open =
  | { kind: "deploy" | "promote" | "preview" | "delete" | "address" }
  | { kind: "rollback"; env: "staging" | "production" }
  | { kind: "remove"; env: "staging" | "production" }
  | { kind: "extend" | "destroy"; environment: Environment };

type Tab = "overview" | "deploys" | "approvals" | "resources" | "deps" | "docs" | "settings";


// One service: what runs in staging and production, its previews, its recent
// history and who owns it. The service's team (and an admin) also deploys,
// promotes, rolls back and manages previews from here.
export default function ServicePage() {
  const { name: id } = useParams<{ name: string }>();
  // Next reuses this page from one service to the next. The key gives each
  // service its own state: an open dialog or a started operation never
  // carries over to another service.
  return <ServiceView key={id} id={id} />;
}

function ServiceView({ id }: { id: string }) {
  const name = `services/${id}`;
  const api = useApi();
  const queries = useQueryClient();
  const { can, role } = usePermissions(id);
  const canUpdate = can("service.update");
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [docPath, setDocPath] = useState(START);
  const [docHash, setDocHash] = useState("");
  const hasDocs = useHasDocs(id);
  // The tab shows once the service has a resource or a plan.
  const hasResources = useResources(id).any;
  // The docs went away (or turned out not to exist) while their tab was open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "docs" && !hasDocs) setTab("overview");
  }, [tab, hasDocs]);
  // A link to "#settings" (from the Ownership page) opens the settings for whoever may change them.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canUpdate && window.location.hash === "#settings") setTab("settings");
  }, [canUpdate]);
  const [started, setStarted] = useState<string[]>([]);
  // The delete of this service: its operation while it runs, "gone" once the service is no more.
  const [deleting, setDeleting] = useState<string | "gone" | null>(null);

  const service = useQuery({
    queryKey: ["service", id],
    queryFn: () => api.catalog.getService({ name }).then((r) => r.service),
  });
  const deployments = useQuery({
    queryKey: ["deployments", id],
    queryFn: () => api.deploys.listDeployments({ service: name }).then((r) => r.deployments),
  });
  const previews = useQuery({
    queryKey: ["environments", id],
    queryFn: () =>
      api.environments.listEnvironments({ service: name }).then((r) => r.environments.filter((e) => e.service === name)),
  });
  const events = useQuery({
    queryKey: ["audit", { service: id, recent: true }],
    queryFn: () => api.audit.listAuditEvents({ service: name, pageSize: 8 }).then((r) => r.events),
  });
  // Work on this service that was already running when the page opened.
  const running = useQuery({
    queryKey: ["operations", "running", id],
    queryFn: () => api.operations.listOperations({ running: true }).then((r) => r.operations),
  });
  const previewNames = new Set((previews.data ?? []).map((e) => e.name));
  const found = (running.data ?? [])
    .filter((op) => op.target.startsWith(`deployments/${id}/`) || op.target.startsWith(`resources/${id}/`) || previewNames.has(op.target))
    .map((op) => op.name);
  // Once seen, an operation stays on the page: when it ends (and, for a
  // destroy, its preview is gone) its result is still there to read.
  const [seen, setSeen] = useState<string[]>([]);
  const fresh = found.filter((n) => !seen.includes(n)).join(" ");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh) setSeen((all) => [...all, ...fresh.split(" ").filter((n) => !all.includes(n))]);
  }, [fresh]);
  const inProgress = [...started, ...[...seen, ...found].filter((n, i, all) => all.indexOf(n) === i && !started.includes(n))];

  // What the page shows may have changed: an action was taken or an operation ended.
  function refresh() {
    for (const key of ["deployments", "environments", "audit", "history", "resources", "plans"]) void queries.invalidateQueries({ queryKey: [key] });
  }
  function onStarted(operation: string | undefined) {
    setOpen(null);
    if (operation) setStarted((s) => (s.includes(operation) ? s : [operation, ...s]));
    refresh();
  }
  const close = () => setOpen(null);
  function gone() {
    setDeleting("gone");
    void queries.invalidateQueries({ queryKey: ["services"] });
    void queries.invalidateQueries({ queryKey: ["deployments"] });
  }
  // A service that ran nothing is removed at once: back to the list. One
  // that ran something is taken down by an operation, shown here until it ends.
  function onDeleteStarted(operation: string | undefined) {
    setOpen(null);
    if (!operation) {
      void queries.invalidateQueries({ queryKey: ["services"] });
      router.replace("/services");
      return;
    }
    setDeleting(operation);
  }

  if (deleting) {
    return (
      <>
        <PageHeader
          mono
          title={id}
          crumbs={
            <Crumbs>
              <Link href="/services">Catalog</Link>
            </Crumbs>
          }
          lead={
            deleting === "gone"
              ? "This service was deleted: everything it ran is taken down and it is out of the catalog. Its GitHub repo is kept."
              : "This service is being deleted. If it fails, the service stays in the catalog and you can delete it again."
          }
          cli={`forge service delete ${id}`}
        />
        {deleting !== "gone" ? (
          <OperationLog
            name={deleting}
            onDone={(op) => {
              if (!op.error) gone();
              else {
                setDeleting(null);
                setStarted((s) => (s.includes(op.name) ? s : [op.name, ...s]));
                refresh();
              }
            }}
          />
        ) : null}
        <p>
          <TextLink href="/services">Back to the services</TextLink>
        </p>
      </>
    );
  }

  if (service.isPending) return <Loading what="the service" />;
  if (service.error) return <ErrorNote error={service.error} />;
  const s = service.data;
  if (!s) return <ErrorNote error={new Error("This service does not exist, or it was removed.")} />;

  const deployment = (env: string) => deployments.data?.find((x) => x.env === env);
  const deployed = (env: string) => {
    const d = deployment(env);
    return !!d && d.health !== Deployment_Health.MISSING && !!d.commit;
  };
  const staging = deployment("staging");
  // Staging is ahead when it runs a commit production does not: that commit can be promoted.
  const ahead = deployed("staging") && staging?.commit !== deployment("production")?.commit;
  // A service without a repo runs an image someone else built: no branches, so no previews.
  const noRepo = !s.repoUrl;
  // A service that runs a published chart shows the chart where an image would be.
  const runsChart = noRepo && !!deployments.data?.some((d) => isChartRef(d.image));
  // An infrastructure repo deploys its code from GitHub Actions, and its
  // production runs wait for approvals. Without an app (infraOnly) it has
  // no Forge deploys, previews or promotes; with one (runs), Forge deploys
  // the app as any service's.
  const infra = s.infrastructure;
  const infraOnly = !!infra && !infra.runs;
  // The deploy environments it has; one made before the choice has both.
  const envs = serviceEnvs(s);
  const bothEnvs = envs.length === 2;

  return (
    <>
      <PageHeader
        mono
        title={id}
        crumbs={
          <Crumbs>
            <Link href="/services">Catalog</Link>
            <span>/</span>
            <span>{s.ownerTeam || "No team"}</span>
          </Crumbs>
        }
        lead={
          <>
            {s.displayName && s.displayName !== id ? <span className="mr-2">{s.displayName}</span> : null}
            <span className="mt-1 inline-flex flex-wrap items-center gap-2 align-middle">
              {deployments.data && !infraOnly ? <StatusBadge status={catalogRows([s], deployments.data)[0].status} /> : null}
              {!infraOnly ? <Chip mono>{envs.join(", ")}</Chip> : null}
              {s.tier ? <Chip>Tier: {tierStatus(s.tier).word}</Chip> : null}
              {s.ownerTeam ? <Chip>Owner: {s.ownerTeam}</Chip> : null}
              <Life lifecycle={s.lifecycle} />
            </span>
          </>
        }
        cli={`forge service get ${id}`}
      >
        {canUpdate || can("environment.create") || can("deploy.start") || can("deploy.promote") ? (
          <>
            {canUpdate ? (
              <Button
                onClick={() => setTab(tab === "settings" ? "overview" : "settings")}
                aria-label="Service settings"
                aria-pressed={tab === "settings"}
                title="Settings"
                className="!px-[9px] aria-pressed:border-fg-3 aria-pressed:bg-surface-2"
              >
                <Icon name="gear" />
              </Button>
            ) : null}
            {can("environment.create") && !noRepo && !infraOnly ? (
              <Button onClick={() => setOpen({ kind: "preview" })}>
                <Icon name="plus" />
                Preview env
              </Button>
            ) : null}
            {infraOnly ? null : bothEnvs && ahead && staging && can("deploy.promote") ? (
              <>
                {can("deploy.start") ? (
                  <Button onClick={() => setOpen({ kind: "deploy" })} aria-label="Deploy to staging">
                    Deploy
                  </Button>
                ) : null}
                <Button
                  kind="primary"
                  onClick={() => setOpen({ kind: "promote" })}
                  aria-label={`Promote ${staging.version || shortCommit(staging.commit)} to production`}
                >
                  <Icon name="ship" />
                  Promote {staging.version || shortCommit(staging.commit)}
                </Button>
              </>
            ) : can("deploy.start") ? (
              <Button kind="primary" onClick={() => setOpen({ kind: "deploy" })} aria-label={`Deploy to ${envs[0]}`}>
                <Icon name="ship" />
                Deploy
              </Button>
            ) : null}
          </>
        ) : null}
      </PageHeader>

      {inProgress.length > 0 ? (
        <Section title="In progress">
          {inProgress.map((op) => (
            <OperationLog
              key={op}
              name={op}
              onDone={refresh}
              argoFor={(target) => deployments.data?.find((d) => d.name === target)?.argoUrl}
            />
          ))}
        </Section>
      ) : null}

      <Tabs
        label={`Parts of ${id}`}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "deploys", label: infraOnly ? "Approvals" : "Deployments" },
          ...(infra && !infraOnly ? [{ value: "approvals" as const, label: "Approvals" }] : []),
          ...(hasResources && !infra ? [{ value: "resources" as const, label: "Resources" }] : []),
          {
            value: "deps",
            label: (
              <>
                Dependencies <span className="font-normal text-fg-3 tabular-nums">{s.dependencies.length}</span>
              </>
            ),
          },
          ...(hasDocs ? [{ value: "docs" as const, label: "Docs" }] : []),
          ...(canUpdate ? [{ value: "settings" as const, label: "Settings" }] : []),
        ]}
      >
        {tab === "deploys" ? infraOnly ? <ServiceApprovals name={s.name} /> : <DeployHistory id={id} envs={envs} /> : null}
        {tab === "approvals" && infra ? <ServiceApprovals name={s.name} /> : null}
        {tab === "resources" && !infra ? (
          <ResourcesTab id={id} canApply={(env) => can(env === "production" ? "resource.apply.production" : "resource.apply")} onStarted={onStarted} />
        ) : null}
        {tab === "deps" ? <Dependencies service={s} /> : null}
        {tab === "docs" && hasDocs ? (
          <>
            <DocsLink id={id} path={docPath}>
              Open in Docs
            </DocsLink>
            <DocReader
              id={id}
              path={docPath}
              hash={docHash}
              nested
              onOpen={(p, h = "") => {
                setDocPath(p);
                setDocHash(h);
              }}
            />
          </>
        ) : null}
        {tab === "settings" && canUpdate ? (
          <div className="flex max-w-[720px] flex-col gap-6">
            <ServiceSettings service={s} canMoveTeam={can("service.update.team")} canChangeRepo={role === "admin"} />
            {can("service.address") || can("service.delete") || (can("deploy.remove") && !infraOnly && envs.some((env) => deployed(env))) ? (
              <Panel className="border-bad-dot/45">
                <section aria-label="Danger zone" className="contents">
                  <div className="px-4 pb-3 pt-4">
                    <h2 className="type-heading text-bad-fg">Danger zone</h2>
                  </div>
                  {can("service.address") ? (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 pb-4">
                      <div className="min-w-0 flex-[1_1_280px]">
                        <b className="font-semibold">Change address</b>
                        <p className="mt-0.5 text-[13.5px] text-fg-2">
                          {s.address
                            ? `Set here, over forge.yaml: ${s.address.host === "@" ? "the domain itself" : s.address.host || id} on ${s.address.domain || "the default domain"}. `
                            : "Comes from forge.yaml. "}
                          Moving it breaks the old address. Rarely needed.
                        </p>
                      </div>
                      <Button kind="danger" onClick={() => setOpen({ kind: "address" })}>
                        Change address
                      </Button>
                    </div>
                  ) : null}
                  {can("deploy.remove") && !infraOnly
                    ? envs.filter((env) => deployed(env)).map((env) => (
                        <div key={env} className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-4 py-4">
                          <div className="min-w-0 flex-[1_1_280px]">
                            <b className="font-semibold">Take down {env}</b>
                            <p className="mt-0.5 text-[13.5px] text-fg-2">
                              Stops what {id} runs in {env}. It stays in the catalog; deploy again to bring {env} back. Needed before {env} can be
                              dropped from its environments.
                            </p>
                          </div>
                          <Button kind="danger" onClick={() => setOpen({ kind: "remove", env })}>
                            Take down {env}
                          </Button>
                        </div>
                      ))
                    : null}
                  {can("service.delete") ? (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-4 py-4">
                      <div className="min-w-0 flex-[1_1_280px]">
                        <b className="font-semibold">Delete service</b>
                        <p className="mt-0.5 text-[13.5px] text-fg-2">
                          Takes down staging, production and any previews, and removes {id} from the catalog.{" "}
                          {noRepo ? "Its forge.yaml is removed from the deploy repo." : "The repository is kept."}
                        </p>
                      </div>
                      <Button kind="danger" onClick={() => setOpen({ kind: "delete" })}>
                        Delete service
                      </Button>
                    </div>
                  ) : null}
                </section>
              </Panel>
            ) : null}
          </div>
        ) : null}
        {tab === "overview" && infraOnly ? (
          <InfrastructureOverview service={s} />
        ) : tab === "overview" ? (
          <>
            <OverviewTab
              id={id}
              service={s}
              deployments={deployments}
              previews={previews}
              events={events}
              can={can}
              ahead={ahead}
              deployment={deployment}
              deployed={deployed}
              onOpen={setOpen}
            />
            {infra ? <InfrastructureOverview service={s} /> : null}
          </>
        ) : null}
      </Tabs>

      {open?.kind === "delete" ? (
        <DeleteServiceDialog
          id={id}
          previews={(previews.data ?? []).map((e) => environmentId(e.name))}
          deployed={(["staging", "production"] as const).filter((env) => deployed(env))}
          onClose={close}
          onStarted={onDeleteStarted}
        />
      ) : null}
      {open?.kind === "address" ? (
        <ChangeAddressDialog
          service={s}
          onClose={close}
          onChanged={() => {
            setOpen(null);
            void queries.invalidateQueries({ queryKey: ["service", id] });
            refresh();
          }}
        />
      ) : null}
      {open?.kind === "deploy" ? <DeployDialog id={id} env={envs[0]} noRepo={noRepo} chart={runsChart} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "remove" ? <RemoveDeploymentDialog id={id} env={open.env} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "promote" ? (
        <PromoteDialog id={id} staging={deployment("staging")} onClose={close} onStarted={onStarted} />
      ) : null}
      {open?.kind === "rollback" ? <RollbackDialog id={id} env={open.env} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "preview" ? <PreviewDialog id={id} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "extend" ? <ExtendDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
      {open?.kind === "destroy" ? <DestroyDialog environment={open.environment} onClose={close} onStarted={onStarted} /> : null}
    </>
  );
}

// argoAppsUrl is Argo CD's list of the service's Applications, on the Argo CD
// the API links deployments to; "" when it links none.
function argoAppsUrl(id: string, deployments: Deployment[] | undefined): string {
  const link = deployments?.find((d) => /^https?:\/\//i.test(d.argoUrl))?.argoUrl;
  if (!link) return "";
  return `${new URL(link).origin}/applications?search=${encodeURIComponent(id)}`;
}

function ArgoLink({ href, id }: { href: string; id: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-[5px] whitespace-nowrap text-[13px] text-info-fg no-underline hover:underline"
    >
      All {id} apps
      <Icon name="external" size={13} />
    </a>
  );
}

// OverviewTab is the service in cards: what it is and who owns it, what it
// uses, what runs in staging and production, then its recent activity and
// its previews.
function OverviewTab({
  id,
  service: s,
  deployments,
  previews,
  events,
  can,
  ahead,
  deployment,
  deployed,
  onOpen: setOpen,
}: {
  id: string;
  service: Service;
  deployments: UseQueryResult<Deployment[]>;
  previews: UseQueryResult<Environment[]>;
  events: UseQueryResult<AuditEvent[]>;
  can: (action: string) => boolean;
  ahead: boolean;
  deployment: (env: string) => Deployment | undefined;
  deployed: (env: string) => boolean;
  onOpen: (open: Open) => void;
}) {
  const argoApps = argoAppsUrl(id, deployments.data);
  const envs = serviceEnvs(s);
  const { resources } = useResources(id);
  // The last deploy of either environment.
  const last = envs
    .map((env) => deployment(env))
    .filter((d): d is Deployment => !!d?.deployTime)
    .sort((a, b) => Number(b.deployTime!.seconds - a.deployTime!.seconds))[0];
  const running = envs.filter((env) => deployed(env));
  const facts: [string, ReactNode][] = [
    ["Repository", s.repoUrl ? <Addr key="r" href={s.repoUrl} className="!whitespace-nowrap !break-normal" /> : "–"],
    [
      "Environments",
      <span key="e" className="inline-flex flex-wrap items-center gap-1.5">
        {running.length ? running.map((env) => <EnvTag key={env} kind={env} />) : <span className="text-fg-3">Not deployed yet</span>}
        {previews.data?.length ? (
          <span className="text-fg-3">
            + {previews.data.length} preview{previews.data.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>,
    ],
    ...(s.labels.template ? ([["Template", <span key="t" className="font-mono">{s.labels.template}</span>]] as [string, ReactNode][]) : []),
    [
      "Last deploy",
      last ? (
        <span key="l" title={exact(last.deployTime)}>
          {when(last.deployTime)} <span className="text-fg-3">({last.version || shortCommit(last.commit)})</span>
        </span>
      ) : (
        <span key="l" className="text-fg-3">
          Never
        </span>
      ),
    ],
    [
      "Owners",
      <Fragment key="o">
        {s.owners.length ? s.owners.join(", ") : "–"}
        <span className="text-fg-3"> · {s.ownerTeam || "no team"}</span>
      </Fragment>,
    ],
    ["Lifecycle", <Life key="lc" lifecycle={s.lifecycle} />],
    ["Tier", s.tier ? <StatusBadge key="t" status={tierStatus(s.tier)} /> : <span key="t" className="text-fg-3">Not set</span>],
    ["SLO target", s.slo ? <span key="s" className="font-mono">{s.slo}</span> : <span key="s" className="text-fg-3">Not set</span>],
    ...(argoApps ? ([["Argo CD", <ArgoLink key="a" href={argoApps} id={id} />]] as [string, ReactNode][]) : []),
    ["Registered", when(s.createTime)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Card icon="box" title="Service overview">
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 text-[13.5px] [&>dd]:border-b [&>dd]:border-line [&>dd]:py-2.5 [&>dt]:border-b [&>dt]:border-line [&>dt]:py-2.5 [&>dd:last-of-type]:border-b-0 [&>dt:last-of-type]:border-b-0">
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-fg-3">{label}</dt>
                <dd className="m-0 min-w-0 break-words">{value}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <GoldenPath id={id} />
          <Card icon="link" title="Related resources">
            {(resources.data?.length ?? 0) === 0 && s.dependencies.length === 0 ? (
              <CardNote>No resources or dependencies.</CardNote>
            ) : (
              <ul aria-label="Related resources" className="m-0 list-none p-0">
                {(resources.data ?? []).map((r) => (
                  <li key={r.name} className="flex items-center justify-between border-b border-line py-2.5 text-[14px] last:border-b-0">
                    <span className="font-mono text-[13px]">
                      {r.name.split("/").pop()} <span className="text-fg-3">· {r.env}</span>
                    </span>
                    <span className="text-[13px] text-fg-3">{r.type}</span>
                  </li>
                ))}
                {s.dependencies.map((d) => (
                  <li key={d} className="flex items-center justify-between border-b border-line py-2.5 text-[14px] last:border-b-0">
                    <NameLink href={`/services/${serviceId(d)}`}>{serviceId(d)}</NameLink>
                    <span className="text-[13px] text-fg-3">Service it calls</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card icon="layers" title={envs.length === 2 ? "Staging and production" : envs[0] === "production" ? "Production" : "Staging"}>
        {deployments.data && envs.length === 2 && deployed("staging") ? (
          <CardNote top>{ahead ? "Staging is ahead of production" : s.repoUrl ? "Both run the same commit" : "Both run the same image"}</CardNote>
        ) : null}
        {deployments.isPending ? (
          <Loading what="deployments" />
        ) : deployments.error ? (
          <ErrorNote error={deployments.error} />
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table aria-label="Deployments" className={ct}>
              <thead>
                <tr>
                  <th className={cth}>Environment</th>
                  <th className={cth}>Status</th>
                  <th className={cth}>Version</th>
                  <th className={cth}>Commit</th>
                  <th className={cth}>Deployed</th>
                  <th className={cth}>Address</th>
                  {can("deploy.rollback") ? <th className={cth}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {envs.map((env) => {
                  const d = deployment(env);
                  return (
                    <tr key={env}>
                      <td className={ctd}>
                        <EnvTag kind={env} />
                      </td>
                      <td className={ctd}>
                        <StatusBadge status={deploymentStatus(d)} title={d?.message || undefined} />
                      </td>
                      <td className={ctd}>
                        <span className={`font-mono text-[13px] ${env === "staging" && ahead ? "font-semibold text-ember-ink" : ""}`}>{d?.version || "–"}</span>
                      </td>
                      <td className={ctd}>
                        <span className="font-mono text-[13px] text-fg-2">{d?.commit ? shortCommit(d.commit) : "–"}</span>
                      </td>
                      <td className={ctd}>
                        <div title={exact(d?.deployTime)}>{when(d?.deployTime)}</div>
                        {d?.deployedBy ? <div className="text-[12.5px] text-fg-3">by {d.deployedBy}</div> : null}
                      </td>
                      <td className={ctd}>
                        {d?.url ? <Addr href={d.url} /> : "–"}
                        {d?.argoUrl && /^https?:\/\//i.test(d.argoUrl) ? (
                          <div>
                            <a
                              href={d.argoUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${env} in Argo CD`}
                              className="text-[12.5px] text-fg-3 no-underline hover:text-info-fg hover:underline"
                            >
                              Argo CD ↗
                            </a>
                          </div>
                        ) : null}
                      </td>
                      {can("deploy.rollback") ? (
                        <td className={ctd}>
                          {deployed(env) ? (
                            <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "rollback", env })} aria-label={`Roll back ${env}`}>
                              Roll back
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Card icon="pulse" title="Recent activity" more={{ href: `/audit?service=${encodeURIComponent(id)}`, label: `All activity of ${id}` }}>
          {events.isPending ? (
            <Loading what="recent activity" />
          ) : events.error ? (
            <ErrorNote error={events.error} />
          ) : events.data.length === 0 ? (
            <CardNote>Nothing has happened to this service yet.</CardNote>
          ) : (
            <ul aria-label="Recent activity" className="m-0 list-none p-0">
              {events.data.map((e) => (
                <li key={e.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-[9px] last:border-b-0">
                  <div className="min-w-0">
                    <div className="min-w-0 font-medium">
                      <span className="font-mono text-[13px]">{e.action}</span> <span className="font-normal text-fg-3">{e.target}</span>
                    </div>
                    <div className="mt-px text-[12.5px] text-fg-3" title={exact(e.time)}>
                      {actorText(e)} · {when(e.time)}
                    </div>
                  </div>
                  <StatusBadge status={auditStatus(e.result?.code)} title={e.result?.message || e.result?.code} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card icon="box" title="Previews">
          {previews.isPending ? (
            <Loading what="previews" />
          ) : previews.error ? (
            <ErrorNote error={previews.error} />
          ) : previews.data.length === 0 ? (
            <CardNote>
              {s.repoUrl ? (
                <>
                  No previews. Create one for any branch with <span className="font-mono text-[12.5px]">forge env create &lt;name&gt; --service {id}</span>.
                </>
              ) : (
                `No previews: ${id} runs an image and has no repo, so it has no branches to preview.`
              )}
            </CardNote>
          ) : (
            <ul aria-label="Previews" className="m-0 list-none p-0">
              {previews.data.map((e) => {
                const preview = environmentId(e.name);
                return (
                  // The row wraps on a narrow screen: the actions drop below the details.
                  <li key={e.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2.5 last:border-b-0">
                    <EnvTag kind="preview" name={preview} />
                    <div className="min-w-0 flex-[1_1_200px]">
                      <div className="min-w-0 font-medium">{e.url ? <Addr href={e.url} /> : <span className="text-fg-3">No address yet</span>}</div>
                      <div className="mt-px text-[12.5px] text-fg-3">
                        <span className="font-mono">{e.ref || "main"}</span>
                        {e.commit ? ` at ${shortCommit(e.commit)}` : ""}
                        {e.creator ? ` · ${e.creator}` : ""}
                        {e.expireTime ? ` · expires ${timeUntil(timestampDate(e.expireTime))}` : ""}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                      <StatusBadge status={environmentStatus(e)} title={e.stateMessage || undefined} />
                      {can("environment.extend") ? (
                        <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "extend", environment: e })} aria-label={`Extend ${preview}`}>
                          Extend
                        </Button>
                      ) : null}
                      {can("environment.destroy") ? (
                        <Button kind="quiet" size="sm" onClick={() => setOpen({ kind: "destroy", environment: e })} aria-label={`Destroy ${preview}`}>
                          Destroy
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

const kindWord: Record<string, string> = { deploy: "Deploy", promote: "Promotion", rollback: "Rollback" };

// DeployHistory lists what was deployed to staging and production, newest
// first, as the deploy repo records it.
function DeployHistory({ id, envs }: { id: string; envs: ("staging" | "production")[] }) {
  return (
    <>
      {envs.map((env) => (
        <EnvHistory key={env} id={id} env={env} />
      ))}
    </>
  );
}

function EnvHistory({ id, env }: { id: string; env: "staging" | "production" }) {
  const api = useApi();
  const history = useQuery({
    queryKey: ["history", id, env, "tab"],
    queryFn: () =>
      api.deploys.listDeployHistory({ name: `deployments/${id}/${env}`, limit: 20 }).then(
        (r) => r.records,
        // Never deployed there: nothing to list.
        (err: unknown) => {
          if (isCode(err, Code.NotFound)) return [];
          throw err;
        },
      ),
  });
  return (
    <Section title={env === "staging" ? "Staging" : "Production"} note={history.data ? history.data.length : undefined}>
      <Cli command={`forge deploy history ${id} --env ${env}`} />
      {history.isPending ? (
        <Loading what={`the history of ${env}`} />
      ) : history.error ? (
        <ErrorNote error={history.error} />
      ) : history.data.length === 0 ? (
        <Panel className="p-6 text-center text-[13.5px] text-fg-2">Nothing was deployed to {env} yet.</Panel>
      ) : (
        <TableFrame label={`History of ${env}`}>
          <thead>
            <tr>
              <th className={th}>What</th>
              <th className={th}>Version</th>
              <th className={th}>Commit</th>
              <th className={th}>By</th>
              <th className={th}>When</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((r, i) => (
              <tr key={r.deployCommit} className={tr}>
                <td className={td}>
                  {kindWord[r.kind] ?? r.kind}
                  {i === 0 ? <span className="ml-2 text-[12.5px] text-fg-3">runs now</span> : null}
                </td>
                <td className={`${td} font-mono text-[13px]`}>{r.version || "–"}</td>
                <td className={`${td} font-mono text-[13px] text-fg-2`}>{r.commit ? shortCommit(r.commit) : "–"}</td>
                <td className={`${td} font-mono text-[12.5px]`}>{r.actor || "–"}</td>
                <td className={`${td} text-fg-3`} title={exact(r.time)}>
                  {when(r.time)}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
}

// Dependencies: what the service calls, and what in the catalog calls it.
function Dependencies({ service: s }: { service: Service }) {
  const api = useApi();
  const id = serviceId(s.name);
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const usedBy = (services.data ?? []).filter((o) => o.dependencies.includes(s.name)).map((o) => serviceId(o.name));
  const chips = (names: string[]) => (
    <ul className="flex flex-wrap gap-2">
      {names.map((n) => (
        <li key={n}>
          <NameLink href={`/services/${n}`} className="inline-flex items-center gap-[7px] rounded-md border border-line bg-surface px-2.5 py-[5px] !text-[12.5px]">
            <span className="font-sans text-[11px] font-normal text-fg-3">service</span>
            {n}
          </NameLink>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <Cli command={`forge service deps ${id}`} />
      <Section title="Depends on">
        {s.dependencies.length ? chips(s.dependencies.map(serviceId)) : <p className="text-fg-3">{id} depends on no other service in the catalog.</p>}
      </Section>
      <Section title="Used by">
        {services.isPending ? (
          <Loading what="the catalog" />
        ) : services.error ? (
          <ErrorNote error={services.error} />
        ) : usedBy.length ? (
          chips(usedBy)
        ) : (
          <p className="text-fg-3">Nothing in the catalog depends on {id}.</p>
        )}
      </Section>
    </>
  );
}

// InfrastructureOverview is the overview of an infrastructure repo: where it
// deploys, how, and whether its team may approve its own runs.
function InfrastructureOverview({ service: s }: { service: Service }) {
  const api = useApi();
  const i = s.infrastructure!;
  const canAsk = useCanAskException(s.name);
  const [asking, setAsking] = useState(false);
  const exception = useQuery({
    queryKey: ["exceptions", s.name],
    queryFn: () => api.approvals.listExceptions({ service: s.name }).then((r) => r.exceptions[0] ?? null),
    retry: false,
  });
  const exceptionText = exception.isPending
    ? "…"
    : exception.error
      ? "–"
      : !exception.data
        ? "None: who starts a production run may not approve it"
        : exception.data.granted
          ? `The team approves its own runs (granted by ${exception.data.grantedBy})`
          : `Asked, not in force: ${exception.data.problem}`;
  // Only a repo with production has runs to approve; a Forge without
  // exceptions answers the list with an error, and then nothing is offered.
  const offer = canAsk && i.environments.includes("production") && !exception.isPending && !exception.error;
  const pullRequest = exception.data?.pullRequestUrl ?? "";
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <Section title="Infrastructure">
        <Panel>
          <div className="p-4">
            <Facts
              items={[
                ["Tool", i.tool],
                ["Target", <span key="t" className="font-mono">{i.target}</span>],
                ["Environments", i.environments.join(", ")],
                ["Repository", s.repoUrl ? <Addr key="r" href={s.repoUrl} /> : "–"],
                ["Exception", exceptionText],
                ...(pullRequest ? ([["Its pull request", <Addr key="p" href={pullRequest} />]] as [string, ReactNode][]) : []),
              ]}
            />
          </div>
          {offer ? (
            <div className="border-t border-line px-4 py-3">
              <Button size="sm" onClick={() => setAsking(true)}>
                {exception.data ? "Revoke exception" : "Ask for an exception"}
              </Button>
            </div>
          ) : null}
        </Panel>
      </Section>
      {asking ? <ExceptionDialog service={s.name} team={s.ownerTeam} revoke={!!exception.data} onClose={() => setAsking(false)} /> : null}
      {i.runs ? (
        <p className="text-fg-2">
          Forge deploys its app like any service&apos;s. Its own GitHub Actions deploy the code in infrastructure/: a merge to main deploys to
          staging (when it has one), then asks for production&apos;s approval, which someone else of team {s.ownerTeam} gives on the Approvals tab.
        </p>
      ) : (
        <p className="text-fg-2">
          Its own GitHub Actions deploy it: a merge to main deploys to staging (when it has one), then asks for production&apos;s approval, which
          someone else of team {s.ownerTeam} gives on the Approvals tab. Forge never deploys it itself.
        </p>
      )}
    </div>
  );
}

// ServiceApprovals lists the approvals of one infrastructure repo.
function ServiceApprovals({ name }: { name: string }) {
  const api = useApi();
  const approvals = useQuery({
    queryKey: ["approvals", name],
    queryFn: () => api.approvals.listApprovals({ service: name, pageSize: 50 }).then((r) => r.approvals),
    refetchInterval: 15_000,
  });
  if (approvals.isPending) return <Loading what="approvals" />;
  if (approvals.error) return <ErrorNote error={approvals.error} />;
  if (approvals.data.length === 0) return <p className="text-fg-2">No production run has asked for an approval yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-2">
        Approve or reject waiting runs on <TextLink href="/approvals">Approvals</TextLink>.
      </p>
      <TableFrame label="Approvals">
        <thead>
          <tr>
            <th className={th}>Commit</th>
            <th className={th}>State</th>
            <th className={th}>Asked by</th>
            <th className={th}>Decided by</th>
            <th className={th}>Asked</th>
          </tr>
        </thead>
        <tbody>
          {approvals.data.map((a) => (
            <tr key={a.name} className={tr}>
              <td className={`${td} font-mono`}>
                {a.runUrl ? (
                  <a className="underline decoration-line-strong underline-offset-2 hover:decoration-fg" href={a.runUrl} target="_blank" rel="noreferrer">
                    {shortCommit(a.commit)}
                  </a>
                ) : (
                  shortCommit(a.commit)
                )}
              </td>
              <td className={td}>
                <StatusBadge status={approvalStatus(a)} title={a.dispatchError || undefined} />
              </td>
              <td className={td}>{a.requestedBy}</td>
              <td className={`${td} text-fg-2`}>{a.decidedBy || "—"}</td>
              <td className={`${td} text-fg-2`}>{when(a.createTime)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </div>
  );
}
