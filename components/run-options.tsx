"use client";

import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import type { RunOptionsSchema } from "@/gen/forge/v1/catalog_pb";

// RunForm is what the create form holds for forge.yaml's run options, as typed.
export type RunForm = {
  replicas: string;
  autoscalingMax: string;
  requestsCpu: string;
  requestsMemory: string;
  limitsCpu: string;
  limitsMemory: string;
  env: { name: string; value: string }[];
  secrets: { name: string; item: string; env: string }[];
  jobs: { name: string; schedule: string; command: string }[];
};

export const emptyRunForm: RunForm = {
  replicas: "",
  autoscalingMax: "",
  requestsCpu: "",
  requestsMemory: "",
  limitsCpu: "",
  limitsMemory: "",
  env: [],
  secrets: [],
  jobs: [],
};

type Init = MessageInitShape<typeof RunOptionsSchema>;

// runOptions turns the form into the API's RunOptions, and the matching
// forge create flags. Only offered options count; empty rows are skipped.
// The API checks the values by forge.yaml's rules.
export function runOptions(form: RunForm, offered: string[]): { options?: Init; flags: [string, string][] } {
  const o: Init = {};
  const flags: [string, string][] = [];
  const on = (name: string) => offered.includes(name);
  const n = (s: string) => Number.parseInt(s.trim(), 10);
  if (on("replicas") && form.replicas.trim()) {
    o.replicas = n(form.replicas);
    flags.push(["--replicas", form.replicas.trim()]);
  }
  if (on("resources")) {
    const r = {
      requestsCpu: form.requestsCpu.trim(),
      requestsMemory: form.requestsMemory.trim(),
      limitsCpu: form.limitsCpu.trim(),
      limitsMemory: form.limitsMemory.trim(),
    };
    const set = (
      [
        ["requests.cpu", r.requestsCpu],
        ["requests.memory", r.requestsMemory],
        ["limits.cpu", r.limitsCpu],
        ["limits.memory", r.limitsMemory],
      ] as const
    ).filter(([, v]) => v);
    if (set.length) {
      o.resources = r;
      flags.push(["--resources", set.map(([k, v]) => `${k}=${v}`).join(",")]);
    }
  }
  if (on("env")) {
    for (const e of form.env.filter((e) => e.name.trim())) {
      (o.env ??= {})[e.name.trim()] = e.value;
      flags.push(["--env", `${e.name.trim()}=${e.value}`]);
    }
  }
  if (on("secrets")) {
    for (const s of form.secrets.filter((s) => s.name.trim() || s.item.trim())) {
      const env: Record<string, string> = {};
      for (const pair of s.env.split(",")) {
        const [k, v = ""] = pair.split("=");
        if (k.trim()) env[k.trim()] = v.trim();
      }
      (o.secrets ??= []).push({ name: s.name.trim(), item: s.item.trim(), env });
      flags.push(["--secret", `${s.name.trim()}=${s.item.trim()}:${s.env.replaceAll(" ", "")}`]);
    }
  }
  if (on("jobs")) {
    for (const j of form.jobs.filter((j) => j.name.trim() || j.command.trim())) {
      (o.jobs ??= []).push({ name: j.name.trim(), schedule: j.schedule.trim(), command: j.command.trim().split(/\s+/) });
      flags.push(["--job", `'${j.name.trim()}=${j.schedule.trim()}:${j.command.trim()}'`]);
    }
  }
  if (on("autoscaling") && form.autoscalingMax.trim()) {
    o.autoscalingMax = n(form.autoscalingMax);
    flags.push(["--autoscaling-max", form.autoscalingMax.trim()]);
  }
  return { options: Object.keys(o).length ? o : undefined, flags };
}

// Option is one run option in the list, folded away until the writer opens
// it; the right of its row says what it is set to.
function Option({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="mr-0.5 size-[7px] shrink-0 -rotate-45 self-center border-r-[1.5px] border-b-[1.5px] border-fg-3 transition-transform group-open:rotate-45"
        />
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="w-full text-[13px] text-fg-3 sm:ml-auto sm:w-auto">{hint}</span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 pl-[33px]">{children}</div>
    </details>
  );
}

const count = (n: number, one: string, many: string) => (n === 0 ? "None" : n === 1 ? `1 ${one}` : `${n} ${many}`);

const small = `${inputClass} font-mono`;

// RunOptionsFields are the run options a template offers, each folded away
// until the writer opens it: leaving them closed keeps the template's values.
export function RunOptionsFields({ offered, form, onChange }: { offered: string[]; form: RunForm; onChange: (f: RunForm) => void }) {
  const set = <K extends keyof RunForm>(k: K, v: RunForm[K]) => onChange({ ...form, [k]: v });
  const row = <K extends "env" | "secrets" | "jobs">(k: K, i: number, patch: Partial<RunForm[K][number]>) =>
    set(k, form[k].map((r, j) => (j === i ? { ...r, ...patch } : r)) as RunForm[K]);
  const drop = <K extends "env" | "secrets" | "jobs">(k: K, i: number) => set(k, form[k].filter((_, j) => j !== i) as RunForm[K]);
  const replicas = form.replicas.trim();
  const resources = [form.requestsCpu, form.requestsMemory, form.limitsCpu, form.limitsMemory].map((v) => v.trim());
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {offered.includes("replicas") ? (
        <Option title="Replicas" hint={`${replicas ? `${replicas} in production` : "The template's number in production"}, 1 in staging`}>
          <Field id="run-replicas" label="Pods in production" hint="1 to 10.">
            <input id="run-replicas" inputMode="numeric" className={small} value={form.replicas} onChange={(e) => set("replicas", e.target.value)} placeholder="1" />
          </Field>
        </Option>
      ) : null}
      {offered.includes("autoscaling") ? (
        <Option title="Autoscaling" hint={form.autoscalingMax.trim() ? `Up to ${form.autoscalingMax.trim()} pods on CPU` : "Off"}>
          <Field id="run-autoscaling" label="Most pods" hint="More than the replicas, at most 10. Empty: no autoscaling.">
            <input id="run-autoscaling" inputMode="numeric" className={small} value={form.autoscalingMax} onChange={(e) => set("autoscalingMax", e.target.value)} />
          </Field>
        </Option>
      ) : null}
      {offered.includes("resources") ? (
        <Option title="Resources" hint={resources.some(Boolean) ? `${resources[0] || "default"} CPU, ${resources[1] || "default"} memory requested` : "The template's CPU and memory"}>
          <div className="grid grid-cols-2 gap-3">
            <Field id="run-req-cpu" label="CPU request">
              <input id="run-req-cpu" className={small} value={form.requestsCpu} onChange={(e) => set("requestsCpu", e.target.value)} placeholder="50m" />
            </Field>
            <Field id="run-req-mem" label="Memory request">
              <input id="run-req-mem" className={small} value={form.requestsMemory} onChange={(e) => set("requestsMemory", e.target.value)} placeholder="64Mi" />
            </Field>
            <Field id="run-lim-cpu" label="CPU limit">
              <input id="run-lim-cpu" className={small} value={form.limitsCpu} onChange={(e) => set("limitsCpu", e.target.value)} placeholder="500m" />
            </Field>
            <Field id="run-lim-mem" label="Memory limit">
              <input id="run-lim-mem" className={small} value={form.limitsMemory} onChange={(e) => set("limitsMemory", e.target.value)} placeholder="512Mi" />
            </Field>
          </div>
        </Option>
      ) : null}
      {offered.includes("env") ? (
        <Option title="Environment variables" hint={count(form.env.filter((e) => e.name.trim()).length, "variable", "variables")}>
          {form.env.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <input aria-label={`Variable ${i + 1} name`} className={small} value={e.name} onChange={(ev) => row("env", i, { name: ev.target.value })} placeholder="LOG_LEVEL" />
              <input aria-label={`Variable ${i + 1} value`} className={small} value={e.value} onChange={(ev) => row("env", i, { value: ev.target.value })} placeholder="info" />
              <Button kind="quiet" size="sm" onClick={() => drop("env", i)} aria-label={`Remove variable ${i + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => set("env", [...form.env, { name: "", value: "" }])}>
              Add variable
            </Button>
          </div>
        </Option>
      ) : null}
      {offered.includes("secrets") ? (
        <Option title="1Password secrets" hint={count(form.secrets.filter((x) => x.name.trim()).length, "secret", "secrets")}>
          {form.secrets.map((s, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md bg-surface-2 p-2">
              <input aria-label={`Secret ${i + 1} name`} className={small} value={s.name} onChange={(ev) => row("secrets", i, { name: ev.target.value })} placeholder="stripe" />
              <input aria-label={`Secret ${i + 1} item`} className={small} value={s.item} onChange={(ev) => row("secrets", i, { item: ev.target.value })} placeholder="vaults/Kube/items/shop-stripe" />
              <input aria-label={`Secret ${i + 1} variables`} className={small} value={s.env} onChange={(ev) => row("secrets", i, { env: ev.target.value })} placeholder="STRIPE_KEY=credential, STRIPE_HOOK=webhook" />
              <div>
                <Button kind="quiet" size="sm" onClick={() => drop("secrets", i)} aria-label={`Remove secret ${i + 1}`}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => set("secrets", [...form.secrets, { name: "", item: "", env: "" }])}>
              Add secret
            </Button>
          </div>
        </Option>
      ) : null}
      {offered.includes("jobs") ? (
        <Option title="Cron jobs" hint={count(form.jobs.filter((j) => j.name.trim()).length, "job", "jobs")}>
          {form.jobs.map((j, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md bg-surface-2 p-2">
              <input aria-label={`Job ${i + 1} name`} className={small} value={j.name} onChange={(ev) => row("jobs", i, { name: ev.target.value })} placeholder="cleanup" />
              <input aria-label={`Job ${i + 1} schedule`} className={small} value={j.schedule} onChange={(ev) => row("jobs", i, { schedule: ev.target.value })} placeholder="0 3 * * *" />
              <input aria-label={`Job ${i + 1} command`} className={small} value={j.command} onChange={(ev) => row("jobs", i, { command: ev.target.value })} placeholder="node scripts/cleanup.js" />
              <div>
                <Button kind="quiet" size="sm" onClick={() => drop("jobs", i)} aria-label={`Remove job ${i + 1}`}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => set("jobs", [...form.jobs, { name: "", schedule: "", command: "" }])}>
              Add job
            </Button>
          </div>
        </Option>
      ) : null}
    </div>
  );
}
