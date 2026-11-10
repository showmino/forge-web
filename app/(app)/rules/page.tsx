"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRole, useWaitingApprovals } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { NameLink, TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, Panel, Section, TableFrame, td, th } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { Rule } from "@/gen/forge/v1/policy_pb";
import { shortCommit, when } from "@/lib/format";

const MODES = [
  ["enforce", "Enforce"],
  ["warn", "Warn"],
  ["off", "Off"],
] as const;

const ruleId = (name: string) => name.replace(/^rules\//, "");

// Rules: what Forge checks before it applies a plan, promotes, runs an image
// or a chart, or makes an infrastructure repo. An admin sets the mode of the
// switchable rules; the rest guard Forge and are always enforced. The
// production runs waiting for the caller's team are first.
export default function Rules() {
  const api = useApi();
  const admin = useRole() === "Admin";
  const waiting = useWaitingApprovals();
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.policy.listRules({}).then((r) => r.rules) });

  const switchable = (rules.data ?? []).filter((r) => r.switchable);
  const always = (rules.data ?? []).filter((r) => !r.switchable);
  const kinds = [...new Set(switchable.map((r) => r.kind))];
  const enforced = switchable.filter((r) => r.mode === "enforce").length;
  const warned = switchable.filter((r) => r.mode === "warn").length;

  return (
    <>
      <PageHeader
        title="Rules"
        lead="What Forge checks before it applies a plan, promotes, runs an image or a chart, or makes an infrastructure repo. Admins set the rules; every action is checked against them."
        cli="forge policy list"
      />

      <Section title="Waiting for approval" note={waiting.length} action={<TextLink href="/approvals" className="text-[13px] !text-fg-2">All approvals</TextLink>}>
        {waiting.length === 0 ? (
          <Empty>Nothing waits for your team. Production runs of infrastructure repos that need an approval appear here.</Empty>
        ) : (
          <Panel>
            <ul aria-label="Waiting for approval">
              {waiting.slice(0, 5).map((a) => (
                <li key={a.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-[11px] first:border-t-0">
                  <span aria-hidden="true" className="w-[3px] self-stretch rounded-[2px] bg-warn-dot" />
                  <div className="min-w-0">
                    <NameLink href={`/services/${a.service.replace(/^services\//, "")}`}>{a.service.replace(/^services\//, "")}</NameLink>{" "}
                    <span className="font-mono text-[13px] font-semibold text-ember-ink">{shortCommit(a.commit)}</span> <span className="text-fg-3">→ production</span>
                    <div className="mt-px text-[12.5px] text-fg-3">
                      Started by {a.requestedBy || "unknown"} {when(a.createTime)}
                    </div>
                  </div>
                  <TextLink href="/approvals" className="text-[13px]">
                    Review
                  </TextLink>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>

      <Section title="Rules" note={rules.data ? `${enforced} enforced, ${warned} warning only` : undefined}>
        {rules.isPending ? (
          <Loading what="the rules" />
        ) : rules.error ? (
          <ErrorNote error={rules.error} />
        ) : (
          <>
            <TableFrame label="Rules">
              <thead>
                <tr>
                  <th className={th}>Rule</th>
                  <th className={th}>Mode</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => (
                  <RuleGroup key={kind} title={kind} rules={switchable.filter((r) => r.kind === kind)} admin={admin} />
                ))}
                <RuleGroup title="Always enforced: these guard Forge itself" rules={always} admin={false} />
              </tbody>
            </TableFrame>
            <p className="text-[12.5px] text-fg-3">
              Warn lets the action through and records the rule&apos;s message in the audit log. Off does not check it. Enforce refuses the action.
            </p>
          </>
        )}
      </Section>
    </>
  );
}

function RuleGroup({ title, rules, admin }: { title: string; rules: Rule[]; admin: boolean }) {
  if (rules.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={2} className="border-b border-line bg-surface-2 px-4 py-1.5 text-[11.5px] tracking-[.06em] text-fg-3 uppercase">
          {title}
        </td>
      </tr>
      {rules.map((r) => (
        <tr key={r.name} className="[&:last-child>td]:border-b-0">
          <td className={`${td} whitespace-normal`}>
            <div className="font-medium">{r.title}</div>
            <div className="text-[12.5px] text-fg-3">
              {r.description} <span className="font-mono">{ruleId(r.name)}</span>
            </div>
          </td>
          <td className={td}>{r.switchable ? <ModeSwitch rule={r} admin={admin} /> : <span className="text-fg-3">Always</span>}</td>
        </tr>
      ))}
    </>
  );
}

// ModeSwitch is a rule's mode: three buttons for an admin, a word for everyone else.
function ModeSwitch({ rule, admin }: { rule: Rule; admin: boolean }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = ruleId(rule.name);
  const changed = rule.mode !== rule.defaultMode;

  if (!admin) {
    return (
      <span>
        {MODES.find(([m]) => m === rule.mode)?.[1] ?? rule.mode}
        {changed ? <span className="text-[12.5px] text-fg-3"> (default {rule.defaultMode})</span> : null}
      </span>
    );
  }

  function set(mode: string) {
    if (mode === rule.mode) return;
    setBusy(true);
    setError(null);
    api.policy.updateRule({ rule: { name: rule.name, mode }, updateMask: { paths: ["mode"] } }).then(
      () => {
        void queries.invalidateQueries({ queryKey: ["rules"] });
        toast(`${id} is ${mode}`, `forge policy set ${id} --mode ${mode}`);
        setBusy(false);
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div role="group" aria-label={`Mode of ${rule.title}`} className="inline-flex overflow-hidden rounded-md border border-line-strong bg-surface">
        {MODES.map(([m, word]) => (
          <button
            key={m}
            type="button"
            aria-pressed={rule.mode === m}
            disabled={busy}
            onClick={() => set(m)}
            className="cursor-pointer border-0 px-2.5 py-1 text-[12.5px] text-fg-2 not-first:border-l not-first:border-line hover:bg-surface-2 hover:text-fg aria-pressed:bg-fg aria-pressed:font-medium aria-pressed:text-bg disabled:cursor-wait"
          >
            {word}
          </button>
        ))}
      </div>
      {changed ? <span className="text-[12px] text-fg-3">Default: {rule.defaultMode}</span> : null}
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}
