"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { Empty, ErrorNote, Loading, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { EnvTag, StatusBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import type { ResourcePlan } from "@/gen/forge/v1/resource_pb";
import { exact, when } from "@/lib/format";
import { applicable, CHANGE_SYMBOLS, changeSummary, changeText, destructive, healthText, planStatus, resourceStatus, settingsText } from "@/lib/resources";

// The Resources tab of a service: what it declares besides its own pods
// (today, Postgres databases), in each environment, and the plans that change
// them. A plan is made from forge.yaml by 'forge resource plan' or by the
// service's CI; here a writer reads it and applies one that is ready. The
// API decides who may apply: the service's team for staging, an admin for
// production.

type Env = "staging" | "production";
const envOf = (env: string): Env => (env === "production" ? "production" : "staging");
const planId = (name: string) => name.replace(/^resourcePlans\//, "");
const shortName = (name: string) => name.split("/").pop() ?? name;

// useResources is the service's resources and its newest plans, for the tab
// and for whether the page shows the tab at all.
export function useResources(id: string) {
  const api = useApi();
  const service = `services/${id}`;
  const resources = useQuery({
    queryKey: ["resources", id],
    queryFn: () => api.resources.listResources({ service }).then((r) => r.resources),
    retry: false,
  });
  const plans = useQuery({
    queryKey: ["plans", id],
    queryFn: () => api.resources.listResourcePlans({ service, pageSize: 20 }).then((r) => r.plans),
    retry: false,
    // A plan made by CI shows up, and one being made or applied moves on.
    refetchInterval: 15_000,
  });
  const any = (resources.data?.length ?? 0) > 0 || (plans.data?.length ?? 0) > 0;
  return { resources, plans, any };
}

export function ResourcesTab({ id, canApply, onStarted }: { id: string; canApply: (env: Env) => boolean; onStarted: (operation: string | undefined) => void }) {
  const { resources, plans } = useResources(id);
  const [applying, setApplying] = useState<ResourcePlan | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Resources" note={resources.data ? resources.data.length : undefined}>
        <Cli command={`forge resource list ${id}`} />
        {resources.isPending ? (
          <Loading what="resources" />
        ) : resources.error ? (
          <ErrorNote error={resources.error} />
        ) : resources.data.length === 0 ? (
          <Empty>
            Nothing applied yet. Declare a database under <span className="font-mono">resources</span> in forge.yaml, then plan it with{" "}
            <span className="font-mono">forge resource plan --env staging</span>.
          </Empty>
        ) : (
          <TableFrame label="Resources">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Environment</th>
                <th className={th}>Settings</th>
                <th className={th}>State</th>
                <th className={th}>Health</th>
                <th className={th}>Secret</th>
              </tr>
            </thead>
            <tbody>
              {resources.data.map((r) => (
                <tr key={r.name} className={tr}>
                  <td className={`${td} font-mono`}>{shortName(r.name)}</td>
                  <td className={td}>
                    <EnvTag kind={envOf(r.env)} />
                  </td>
                  <td className={td}>{settingsText(r.settings)}</td>
                  <td className={td}>
                    <StatusBadge status={resourceStatus(r)} />
                  </td>
                  <td className={`${td} text-fg-2`}>{healthText(r)}</td>
                  <td className={`${td} font-mono text-[12.5px] text-fg-2`}>{r.secret || "–"}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>

      <Section title="Plans" note={plans.data ? plans.data.length : undefined}>
        <Cli command={`forge resource plan --env staging`} />
        {plans.isPending ? (
          <Loading what="plans" />
        ) : plans.error ? (
          <ErrorNote error={plans.error} />
        ) : plans.data.length === 0 ? (
          <Empty>No plan yet. A plan is made from forge.yaml by forge resource plan or by the service&apos;s CI, and is applied once.</Empty>
        ) : (
          <TableFrame label="Plans">
            <thead>
              <tr>
                <th className={th}>Plan</th>
                <th className={th}>Environment</th>
                <th className={th}>State</th>
                <th className={th}>Changes</th>
                <th className={th}>Policy</th>
                <th className={th}>By</th>
                <th className={th}>Made</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.data.map((p) => {
                const env = envOf(p.env);
                return (
                  <tr key={p.name} className={tr}>
                    <td className={`${td} font-mono text-[13px]`}>{planId(p.name)}</td>
                    <td className={td}>
                      <EnvTag kind={env} />
                    </td>
                    <td className={td}>
                      <StatusBadge status={planStatus(p)} title={p.message || undefined} />
                    </td>
                    <td className={`${td} font-mono text-[13px]`} title={p.changes.map(changeText).join("\n") || undefined}>
                      {changeSummary(p)}
                    </td>
                    <td className={`${td} whitespace-normal text-fg-2`}>{policyText(p)}</td>
                    <td className={`${td} font-mono text-[12.5px]`}>{p.creator || "–"}</td>
                    <td className={`${td} text-fg-3`} title={exact(p.createTime)}>
                      {when(p.createTime)}
                    </td>
                    <td className={`${td} text-right`}>
                      {applicable(p) && canApply(env) ? (
                        <Button size="sm" kind="primary" onClick={() => setApplying(p)} aria-label={`Apply plan ${planId(p.name)}`}>
                          Apply
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </Section>

      {applying ? (
        <ApplyPlanDialog
          id={id}
          plan={applying}
          onClose={() => setApplying(null)}
          onStarted={(op) => {
            setApplying(null);
            onStarted(op);
          }}
        />
      ) : null}
    </div>
  );
}

// policyText is what the rules said: why they deny, or how many warnings.
function policyText(p: ResourcePlan): string {
  const pol = p.policy;
  if (!pol) return "–";
  if (pol.denied) return pol.deny.join("; ") || "Denied";
  if (pol.warn.length) return pol.warn.length === 1 ? "Allowed, 1 warning" : `Allowed, ${pol.warn.length} warnings`;
  return "Allowed";
}

// ApplyPlanDialog applies one plan. It shows every change and warning, and
// a plan that deletes or replaces a database asks for that database's name,
// as 'forge resource apply' does.
export function ApplyPlanDialog({ id, plan, onClose, onStarted }: { id: string; plan: ResourcePlan; onClose: () => void; onStarted: (operation: string | undefined) => void }) {
  const api = useApi();
  const toast = useToast();
  const lost = destructive(plan);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const confirmed = lost.every((r) => typed[r]?.trim() === r);
  const env = envOf(plan.env);

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api.resources.applyResourcePlan({ name: plan.name }).then(
      (r) => {
        toast(`Applying the resources of ${id} in ${env}`, `forge resource apply ${plan.name}`);
        onStarted(r.operation?.name);
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  return (
    <Dialog title={`Apply plan ${planId(plan.name)} to ${env}?`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p>
          Forge makes exactly these changes to the resources of {id} in {env}. A deploy afterwards gives the app its connection string.
        </p>
        {plan.changes.length === 0 ? (
          <p className="text-fg-2">The plan changes nothing.</p>
        ) : (
          <ul aria-label="Changes" className="flex flex-col gap-1 rounded-md bg-surface-2 p-3 font-mono text-[12.5px]">
            {plan.changes.map((c) => (
              <li key={`${c.action}-${c.resource}`} className={c.action === "delete" || c.action === "replace" ? "text-bad-fg" : undefined}>
                {CHANGE_SYMBOLS[c.action] ?? "?"} {changeText(c)}
              </li>
            ))}
          </ul>
        )}
        {plan.policy?.warn.length ? (
          <ul aria-label="Warnings" className="flex list-disc flex-col gap-1 pl-5 text-fg-2">
            {plan.policy.warn.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {lost.map((r) => (
          <Field key={r} id={`confirm-${r}`} label={`Type ${r} to delete it and its data`}>
            <input
              id={`confirm-${r}`}
              className={inputClass}
              value={typed[r] ?? ""}
              onChange={(e) => setTyped((t) => ({ ...t, [r]: e.target.value }))}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ))}
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind={lost.length ? "danger" : "primary"} type="submit" disabled={busy || !confirmed}>
            {busy ? "Applying" : `Apply to ${env}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
