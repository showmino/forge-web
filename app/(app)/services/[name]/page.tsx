"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { usePermissions } from "@/components/app-shell";
import { DocReader, DocsLink, useHasDocs } from "@/components/doc-reader";
import { OperationLog } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import {
  ChangeAddressDialog,
  DeleteServiceDialog,
  DeployDialog,
  DestroyDialog,
  ExtendDialog,
  PreviewDialog,
  PromoteDialog,
  RollbackDialog,
} from "@/components/service-actions";
import { ServiceSettings } from "@/components/service-settings";
import { Addr, Button, Icon, NameLink, TextLink } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Crumbs, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, Life, StatusBadge } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import type { Service } from "@/gen/forge/v1/catalog_pb";
import { type Deployment, Deployment_Health } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId, isCode, listAllServices, serviceId } from "@/lib/api";
import { START } from "@/lib/docs";
import { actorText, exact, shortCommit, timeUntil, when } from "@/lib/format";
import { auditStatus, deploymentStatus, environmentStatus } from "@/lib/status";

type Open =
  | { kind: "deploy" | "promote" | "preview" | "delete" | "address" }
  | { kind: "rollback"; env: "staging" | "production" }
  | { kind: "extend" | "destroy"; environment: Environment };

type Tab = "overview" | "deploys" | "deps" | "docs" | "settings";

const row = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0";

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
    .filter((op) => op.target.startsWith(`deployments/${id}/`) || previewNames.has(op.target))
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
    for (const key of ["deployments", "environments", "audit", "history"]) void queries.invalidateQueries({ queryKey: [key] });
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
              <Link href="/services">Services</Link>
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

  return (
    <>
      <PageHeader
        mono
        title={id}
        crumbs={
          <Crumbs>
            <Link href="/services">Services</Link>
            <span>/</span>
            <span>{s.ownerTeam || "No team"}</span>
          </Crumbs>
        }
        lead={
          <>
            {s.displayName && s.displayName !== id ? `${s.displayName} ` : null}
            <Life lifecycle={s.lifecycle} />
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
            {can("environment.create") && !noRepo ? (
              <Button onClick={() => setOpen({ kind: "preview" })}>
                <Icon name="plus" />
                Preview env
              </Button>
            ) : null}
            {ahead && staging && can("deploy.promote") ? (
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
              <Button kind="primary" onClick={() => setOpen({ kind: "deploy" })} aria-label="Deploy to staging">
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
          { value: "deploys", label: "Deployments" },
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
        {tab === "deploys" ? <DeployHistory id={id} /> : null}
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
            {can("service.address") || can("service.delete") ? (
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
        {tab === "overview" ? (
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
      {open?.kind === "deploy" ? <DeployDialog id={id} noRepo={noRepo} onClose={close} onStarted={onStarted} /> : null}
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

// OverviewTab is what runs where, the previews, the recent history and who owns the service.
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
  return (
    <>
      <Section
        title="Staging and production"
        note={
          deployments.data && deployed("staging")
            ? ahead
              ? "Staging is ahead of production"
              : s.repoUrl
                ? "Both run the same commit"
                : "Both run the same image"
            : undefined
        }
      >
        {deployments.isPending ? (
          <Loading what="deployments" />
        ) : deployments.error ? (
          <ErrorNote error={deployments.error} />
        ) : (
          <TableFrame label="Deployments">
            <thead>
              <tr>
                <th className={th}>Environment</th>
                <th className={th}>Status</th>
                <th className={th}>Version</th>
                <th className={th}>Commit</th>
                <th className={th}>Deployed</th>
                <th className={th}>Address</th>
                {can("deploy.rollback") ? <th className={th}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {(["staging", "production"] as const).map((env) => {
                const d = deployment(env);
                return (
                  <tr key={env} className={tr}>
                    <td className={td}>
                      <EnvTag kind={env} />
                    </td>
                    <td className={td}>
                      <StatusBadge status={deploymentStatus(d)} title={d?.message || undefined} />
                    </td>
                    <td className={td}>
                      <span className={`font-mono text-[13px] ${env === "staging" && ahead ? "font-semibold text-ember-ink" : ""}`}>
                        {d?.version || "–"}
                      </span>
                    </td>
                    <td className={td}>
                      <span className="font-mono text-[13px] text-fg-2">{d?.commit ? shortCommit(d.commit) : "–"}</span>
                    </td>
                    <td className={td}>
                      <div title={exact(d?.deployTime)}>{when(d?.deployTime)}</div>
                      {d?.deployedBy ? <div className="text-[12.5px] text-fg-3">by {d.deployedBy}</div> : null}
                    </td>
                    <td className={td}>
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
                      <td className={td}>
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
          </TableFrame>
        )}
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 min-[1081px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Previews" note={previews.data ? String(previews.data.length) : undefined}>
            {previews.isPending ? (
              <Loading what="previews" />
            ) : previews.error ? (
              <ErrorNote error={previews.error} />
            ) : previews.data.length === 0 ? (
              <Panel className="p-6 text-center text-[13.5px] text-fg-2">
                {s.repoUrl ? (
                  <>
                    No previews. Create one for any branch with{" "}
                    <span className="font-mono text-[12.5px]">forge env create &lt;name&gt; --service {id}</span>.
                  </>
                ) : (
                  `No previews: ${id} runs an image and has no repo, so it has no branches to preview.`
                )}
              </Panel>
            ) : (
              <Panel>
                <ul aria-label="Previews">
                  {previews.data.map((e) => {
                    const preview = environmentId(e.name);
                    return (
                      // The row wraps on a narrow screen: the actions drop below the details.
                      <li key={e.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-[11px] first:border-t-0">
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
              </Panel>
            )}
          </Section>

          <Section
            title="Recent activity"
            action={
              <TextLink href={`/audit?service=${encodeURIComponent(id)}`} className="text-[13px] !text-fg-2">
                All activity of {id}
              </TextLink>
            }
          >
            {events.isPending ? (
              <Loading what="recent activity" />
            ) : events.error ? (
              <ErrorNote error={events.error} />
            ) : events.data.length === 0 ? (
              <Panel className="p-6 text-center text-[13.5px] text-fg-2">Nothing has happened to this service yet.</Panel>
            ) : (
              <Panel>
                <ul aria-label="Recent activity">
                  {events.data.map((e) => (
                    <li key={e.name} className={row}>
                      <span aria-hidden="true" className="w-[3px] self-stretch rounded-sm bg-line-strong" />
                      <div className="min-w-0">
                        <div className="min-w-0 font-medium">
                          <span className="font-mono text-[13px]">{e.action}</span>{" "}
                          <span className="font-normal text-fg-3">{e.target}</span>
                        </div>
                        <div className="mt-px text-[12.5px] text-fg-3" title={exact(e.time)}>
                          {actorText(e)} · {when(e.time)}
                        </div>
                      </div>
                      <StatusBadge status={auditStatus(e.result?.code)} title={e.result?.message || e.result?.code} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="About">
            <Panel>
              <div className="p-4">
                <Facts
                  items={[
                    ["Team", s.ownerTeam || "–"],
                    ["Owners", s.owners.length ? s.owners.join(", ") : "–"],
                    ["Lifecycle", <Life key="l" lifecycle={s.lifecycle} />],
                    ...(argoApps ? ([["Argo CD", <ArgoLink key="a" href={argoApps} id={id} />]] as [string, ReactNode][]) : []),
                    ["Repository", s.repoUrl ? <Addr key="r" href={s.repoUrl} className="!whitespace-nowrap !break-normal" /> : "–"],
                    [
                      "Depends on",
                      s.dependencies.length
                        ? s.dependencies.map((d, i) => (
                            <span key={d}>
                              {i > 0 ? ", " : null}
                              <NameLink href={`/services/${serviceId(d)}`}>{serviceId(d)}</NameLink>
                            </span>
                          ))
                        : "–",
                    ],
                    // Not catalog fields: read from the service's labels when it has them.
                    ["Tier", s.labels.tier || "–"],
                    ["SLO", s.labels.slo || "–"],
                    ["Template", s.labels.template || "–"],
                    ["Registered", when(s.createTime)],
                  ]}
                />
              </div>
            </Panel>
          </Section>
        </div>
      </div>
    </>
  );
}

const kindWord: Record<string, string> = { deploy: "Deploy", promote: "Promotion", rollback: "Rollback" };

// DeployHistory lists what was deployed to staging and production, newest
// first, as the deploy repo records it.
function DeployHistory({ id }: { id: string }) {
  return (
    <>
      {(["staging", "production"] as const).map((env) => (
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
