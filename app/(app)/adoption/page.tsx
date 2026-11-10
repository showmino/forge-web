"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApi } from "@/components/providers";
import { ErrorNote, Loading, PageHeader } from "@/components/ui/layout";
import { Card, CardNote, ct, ctd, cth, More, Stat, Stats } from "@/components/ui/portal";
import type { AdoptionWeek } from "@/gen/forge/v1/audit_pb";
import { Resource_State } from "@/gen/forge/v1/resource_pb";
import { listAllServices } from "@/lib/api";
import { change, selfServed, stuck } from "@/lib/adoption";

// Adoption: is Forge being used, and where are teams getting stuck. The
// numbers come from the audit log (GetAdoption); what is stuck from the
// catalog, the teams, the golden-path checks and the resources.
export default function Adoption() {
  const api = useApi();
  const adoption = useQuery({ queryKey: ["adoption"], queryFn: () => api.audit.getAdoption({}) });
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.teams.listTeams({}).then((r) => r.teams), retry: false });
  const deployments = useQuery({ queryKey: ["deployments"], queryFn: () => api.deploys.listDeployments({}).then((r) => r.deployments) });
  const checks = useQuery({ queryKey: ["checks", "all"], queryFn: () => api.catalog.listServiceChecks({}).then((r) => r.services), retry: false });
  const resources = useQuery({ queryKey: ["resources", "all"], queryFn: () => api.resources.listResources({}).then((r) => r.resources), retry: false });

  const items = useMemo(
    () => (services.data && deployments.data ? stuck(services.data, teams.data, deployments.data, checks.data, resources.data) : []),
    [services.data, teams.data, deployments.data, checks.data, resources.data],
  );
  const last = adoption.data?.last;
  const prev = adoption.data?.previous;
  const share = selfServed(last);
  const shareBefore = selfServed(prev);
  const members = (teams.data ?? []).reduce((n, t) => n + t.memberCount, 0);
  const applied = (resources.data ?? []).filter((r) => r.state === Resource_State.READY);
  const resourceTeams = new Set(applied.map((r) => services.data?.find((s) => s.name === r.service)?.ownerTeam).filter(Boolean)).size;

  return (
    <>
      <PageHeader title="Adoption" lead="Is Forge being used, and where are teams getting stuck?" cli="forge audit adoption" />
      <div className="flex flex-col gap-4">
        {adoption.error ? <ErrorNote error={adoption.error} /> : null}
        <Stats label="The last 30 days">
          <Stat icon="box" label="Active people" value={last ? last.activeUsers : "…"} chip={members ? `of ${members} team seats` : undefined} />
          <Stat
            icon="rocket"
            label="Deployments (30 days)"
            value={last ? last.deploys : "…"}
            chip={last && prev ? change(last.deploys, prev.deploys) && `${change(last.deploys, prev.deploys)} vs the 30 before` : undefined}
            tone={last && prev && last.deploys >= prev.deploys ? "success" : "neutral"}
          />
          <Stat
            icon="layers"
            label="Self-service"
            value={
              share === null ? (
                "–"
              ) : (
                <>
                  {share}
                  <small className="ml-px text-[16px] font-semibold">%</small>
                </>
              )
            }
            chip={last && last.writes ? `${last.selfServed} of ${last.writes} changes` : "no roles recorded yet"}
            tone={share !== null && shareBefore !== null && share >= shareBefore ? "success" : "neutral"}
          />
          <Stat icon="db" label="Resources applied" value={resources.data ? applied.length : "…"} chip={resources.data ? `across ${resourceTeams} team${resourceTeams === 1 ? "" : "s"}` : undefined} />
        </Stats>

        <h2 className="m-0 mt-2 font-display text-[17px] font-[650] [font-stretch:104%]">Where adoption is stuck</h2>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-4 max-[1100px]:grid-cols-1">
          <Card
            icon="flag"
            title={
              <>
                Action items{" "}
                {items.length ? <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-md bg-bad-bg px-1.5 align-[2px] font-sans text-[12px] text-bad-fg">{items.length}</span> : null}
              </>
            }
          >
            {services.isPending || deployments.isPending ? (
              <Loading what="what is stuck" />
            ) : services.error ? (
              <ErrorNote error={services.error} />
            ) : items.length === 0 ? (
              <CardNote>Nothing is stuck.</CardNote>
            ) : (
              <ul aria-label="Action items" className="m-0 list-none p-0">
                {items.map((it) => (
                  <li key={it.key} className="relative flex items-start justify-between gap-4 border-b border-line py-3 pl-3.5 last:border-b-0 max-[700px]:flex-col max-[700px]:gap-1.5">
                    <span aria-hidden="true" className={`absolute top-[18px] left-0 size-[7px] rounded-full ${it.tone === "bad" ? "bg-bad-dot" : "bg-warn-dot"}`} />
                    <div className="min-w-0">
                      <b className="text-[14px] font-semibold">{it.title}</b>
                      <p className="mt-[3px] mb-0 text-[12.5px] break-words text-fg-3">{it.detail}</p>
                    </div>
                    <More href={it.href} className="mt-0.5">
                      {it.action}
                    </More>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card icon="pulse" title="The last 12 weeks">
            {adoption.isPending ? (
              <Loading what="the weeks" />
            ) : adoption.data ? (
              <Trend weeks={adoption.data.weeks} since={adoption.data.since ? timestampDate(adoption.data.since) : undefined} />
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

const SERIES: { key: keyof Pick<AdoptionWeek, "deploys" | "selfServed" | "activeUsers">; title: string }[] = [
  { key: "deploys", title: "Deployments" },
  { key: "selfServed", title: "Self-served changes" },
  { key: "activeUsers", title: "Active people" },
];

const weekOf = (w: AdoptionWeek) => (w.start ? timestampDate(w.start).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : "");

// Trend is the three weekly numbers, each its own small bar chart on its own
// scale (three counts of different things share no axis), with a table view.
function Trend({ weeks, since }: { weeks: AdoptionWeek[]; since: Date | undefined }) {
  const [table, setTable] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {SERIES.map((s) => (
        <Bars key={s.key} title={s.title} weeks={weeks} value={(w) => w[s.key]} />
      ))}
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-fg-3">
        {since ? <span>Counted from {since.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.</span> : null}
        <button type="button" className="ml-auto cursor-pointer text-fg-2 underline" aria-expanded={table} onClick={() => setTable(!table)}>
          {table ? "Hide the table" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table aria-label="Weeks" className={ct}>
            <thead>
              <tr>
                <th className={cth}>Week of</th>
                {SERIES.map((s) => (
                  <th key={s.key} className={`${cth} text-right`}>
                    {s.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={weekOf(w)}>
                  <td className={ctd}>{weekOf(w)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className={`${ctd} text-right`}>
                      {w[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// Bars is one weekly series: thin bars from a shared baseline, the latest
// value named, and each week's value on hover.
function Bars({ title, weeks, value }: { title: string; weeks: AdoptionWeek[]; value: (w: AdoptionWeek) => number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = weeks.map(value);
  const max = Math.max(1, ...values);
  const latest = values.at(-1) ?? 0;
  const W = 360;
  const H = 56;
  const slot = W / Math.max(1, values.length);
  const bar = Math.max(4, slot - 6);
  const shown = hover ?? values.length - 1;
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-fg-2">{title}</span>
        <span className="tabular-nums">
          <b className="font-semibold">{values[shown] ?? 0}</b> <span className="text-[12px] text-fg-3">{hover === null ? "this week" : `week of ${weekOf(weeks[shown])}`}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-14 w-full" role="img" aria-label={`${title} per week, the latest ${latest}`} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-line" strokeWidth="1" />
        {values.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(4, ((H - 4) * v) / max);
          const x = i * slot + (slot - bar) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${H - 1} v${-(h - 4)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 v${h - 4} z`}
                  className={i === values.length - 1 || i === hover ? "fill-info-dot" : "fill-info-dot opacity-45"}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
