"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePermissions } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { ButtonLink, Icon } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { Deployment_Health, type Deployment } from "@/gen/forge/v1/deploy_pb";
import { listAllServices, serviceId } from "@/lib/api";
import { when } from "@/lib/format";
import { SEVERITY_RANK, severity, worse, type Severity } from "@/lib/overview";

type View = "all" | "attention";

const dotColor: Record<Severity, string> = {
  bad: "bg-bad-dot",
  warn: "bg-warn-dot",
  ok: "bg-ok-dot",
  none: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--fg-3)]",
};
const statusText: Record<Severity, string> = {
  bad: "text-bad-fg font-medium",
  warn: "text-warn-fg font-medium",
  ok: "text-fg-2 font-medium",
  none: "text-fg-3",
};

// The status column: the worse environment's trouble, in production before
// staging, that it was never deployed, or that it is healthy.
function statusOf(
  prod: Deployment | undefined,
  prodSev: Severity,
  staging: Deployment | undefined,
  stagingSev: Severity,
): { text: string; tone: Severity } {
  const trouble = (d: Deployment | undefined, env: string) => ({
    text: `${d?.health === Deployment_Health.MISSING ? "Not running" : "Degraded"} in ${env}`,
    tone: "bad" as const,
  });
  const stale = (env: string) => ({ text: `Out of sync in ${env}`, tone: "warn" as const });
  if (prodSev === "bad") return trouble(prod, "production");
  if (stagingSev === "bad") return trouble(staging, "staging");
  if (prodSev === "warn") return stale("production");
  if (stagingSev === "warn") return stale("staging");
  if (prodSev === "none") return { text: "Not deployed", tone: "none" };
  return { text: "Healthy", tone: "ok" };
}

// The catalog: every service, who owns it, and how staging and production are doing.
export default function Catalog() {
  const api = useApi();
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments),
  });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const canCreate = usePermissions().can("service.create");

  const byEnv = useMemo(() => {
    const m = new Map<string, Deployment>();
    for (const d of deployments.data ?? []) m.set(`${d.service}/${d.env}`, d);
    return m;
  }, [deployments.data]);

  // services.data ?? [] would make a new array every render; memoize so rows below doesn't recompute for nothing.
  const all = useMemo(() => services.data ?? [], [services.data]);
  // Loading shows every service as fine rather than flash "not deployed" for all of them.
  const pending = deployments.isPending;
  const rows = useMemo(() => {
    return all.map((s) => {
      const id = serviceId(s.name);
      const prod = byEnv.get(`${s.name}/production`);
      const staging = byEnv.get(`${s.name}/staging`);
      const prodSev = pending ? "ok" : severity(prod);
      const stagingSev = pending ? "ok" : severity(staging);
      return { s, id, hot: worse(prodSev, stagingSev), status: statusOf(prod, prodSev, staging, stagingSev) };
    });
  }, [all, byEnv, pending]);
  const hot = rows.filter((r) => r.hot === "bad" || r.hot === "warn").length;

  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !needle || `${r.id} ${r.s.displayName} ${r.s.ownerTeam} ${r.s.owners.join(" ")}`.toLowerCase().includes(needle))
    .filter((r) => view === "all" || r.hot === "bad" || r.hot === "warn")
    .sort((a, b) => SEVERITY_RANK[a.hot] - SEVERITY_RANK[b.hot] || a.id.localeCompare(b.id));

  return (
    <>
      <PageHeader title="Services" lead="Everything you run, and whether it is healthy." cli="forge service list">
        {canCreate ? (
          <ButtonLink kind="primary" href="/create">
            <Icon name="plus" />
            Create service
          </ButtonLink>
        ) : null}
      </PageHeader>

      {services.isPending ? (
        <Loading what="services" />
      ) : services.error ? (
        <ErrorNote error={services.error} />
      ) : all.length === 0 ? (
        <Empty>No services yet. {canCreate ? "Create the first one from a template." : "Members of a team create one from a template."}</Empty>
      ) : (
        <>
          {deployments.error ? <ErrorNote error={deployments.error} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div role="group" aria-label="Show" className="flex gap-6">
              <button
                type="button"
                className={`border-b-2 py-1.5 text-[14px] ${view === "all" ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
                aria-pressed={view === "all"}
                onClick={() => setView("all")}
              >
                All <span className="ml-1 text-[12px] text-fg-3">{all.length}</span>
              </button>
              <button
                type="button"
                className={`border-b-2 py-1.5 text-[14px] ${view === "attention" ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
                aria-pressed={view === "attention"}
                onClick={() => setView("attention")}
              >
                Needs attention <span className={`ml-1 text-[12px] ${hot ? "font-semibold text-bad-fg" : "text-fg-3"}`}>{hot}</span>
              </button>
            </div>
            <label className="flex-1 min-[861px]:flex-none">
              <span className="sr-only">Find a service</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a service"
                className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-[13.5px] text-fg placeholder:text-fg-3 min-[861px]:w-[240px]"
              />
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="text-fg-2">
              No services match.{" "}
              <button
                type="button"
                className="cursor-pointer text-ember-ink underline"
                onClick={() => {
                  setQuery("");
                  setView("all");
                }}
              >
                Clear
              </button>
            </p>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_170px_110px] gap-x-4 px-5 text-[11.5px] font-semibold uppercase tracking-wide text-fg-3 min-[861px]:grid"
              >
                <span>Name</span>
                <span>Status</span>
                <span>Team</span>
                <span className="text-right">Updated</span>
              </div>
              <ul className="flex flex-col gap-2.5">
                {shown.map(({ s, id, status: rowStatus }) => (
                  <li key={s.name}>
                    <Link
                      href={`/services/${id}`}
                      aria-label={id}
                      className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-5 py-[18px] no-underline shadow-1 transition-colors hover:border-line-strong min-[861px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_170px_110px]"
                    >
                      <span className="col-start-1 row-start-1 flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-mono text-[15.5px] font-semibold">{id}</span>
                        {s.displayName && s.displayName !== id ? <span className="truncate text-[13px] text-fg-3">{s.displayName}</span> : null}
                      </span>
                      <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2 min-[861px]:col-span-1 min-[861px]:col-start-2 min-[861px]:row-start-1">
                        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotColor[rowStatus.tone]}`} />
                        <span className={`truncate text-[13.5px] ${statusText[rowStatus.tone]}`}>{rowStatus.text}</span>
                      </span>
                      <span className="col-start-2 row-start-1 hidden truncate text-[13px] text-fg-2 min-[861px]:col-start-3 min-[861px]:block">{s.ownerTeam || "–"}</span>
                      <span className="col-start-2 row-start-1 whitespace-nowrap text-right text-[13px] text-fg-3 min-[861px]:col-start-4">{when(s.updateTime)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
