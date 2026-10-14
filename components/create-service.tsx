"use client";

import { Code, ConnectError } from "@connectrpc/connect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useCanWrite } from "@/components/app-shell";
import { StepLog, type Step } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { emptyRunForm, RunOptionsFields, runOptions, type RunForm } from "@/components/run-options";
import { Addr, Button, TextLink } from "@/components/ui/button";
import { CommandBlock } from "@/components/ui/cli";
import { Field, inputClass } from "@/components/ui/field";
import { Crumbs, ErrorNote, Loading, PageHeader, Panel, Section } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { CreateStep_State, type Service } from "@/gen/forge/v1/catalog_pb";
import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";
import { serviceId, teamId, templateId } from "@/lib/api";
import { randomString } from "@/lib/auth/pkce";
import { paramProblem, paramSummary } from "@/lib/params";

const SERVICE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// The steps of a create, in the words of the CLI: what is happening, then what was done.
const words: Record<string, [doing: string, done: string]> = {
  fetch: ["Fetching the template", "Fetched template"],
  render: ["Rendering the files", "Rendered"],
  create_repo: ["Creating the repo", "Created"],
  push: ["Pushing the first commit", "Pushed the first commit"],
  register: ["Registering the service", "Registered"],
  pull_request: ["Opening the pull request", "Opened"],
};

type Change = { repoUrl: string; branch: string; pullRequestUrl: string; files: string[] };
type Outcome = { service?: Service; change?: Change; failure?: { step: string; message: string; rolledBack: boolean }; error?: unknown };

// Answers after which the API did nothing more: the next attempt is a new create.
const REFUSED = [Code.InvalidArgument, Code.FailedPrecondition, Code.PermissionDenied, Code.Unauthenticated, Code.AlreadyExists, Code.NotFound];

// shown is what a parameter's control displays: the writer's own value, or the
// one that applies when they give none.
function shown(p: TemplateParameter, own: string | undefined): string {
  if (own !== undefined) return own;
  if (p.type === TemplateParameter_Type.BOOL || p.type === TemplateParameter_Type.LIST) return p.defaultValue;
  // A required choice has no default: the first value is selected, and sent.
  if (p.type === TemplateParameter_Type.ENUM) return p.defaultValue || (p.required ? (p.values[0] ?? "") : "");
  return "";
}

// sent is what goes to the API for a parameter, or undefined to leave it to
// the template. A default is never sent back: the API hands it out as the
// template wrote it (it may refer to the repo, "github.com/{owner}/{name}")
// and fills it in only when the parameter is absent.
function sent(p: TemplateParameter, own: string | undefined): string | undefined {
  // A list with nothing ticked is a value: none of them.
  if (p.type === TemplateParameter_Type.LIST && own !== undefined) return own;
  if (own !== undefined && own !== "") return own;
  if (own === undefined && p.type === TemplateParameter_Type.ENUM && p.required && !p.defaultValue) return p.values[0];
  // A required bool left unticked is false.
  if (own === undefined && p.type === TemplateParameter_Type.BOOL && p.required && !p.defaultValue) return "false";
  return undefined;
}

function ParameterField({ p, own, error, onChange }: { p: TemplateParameter; own: string | undefined; error?: string; onChange: (v: string) => void }) {
  const id = `param-${p.name}`;
  const label = p.label || p.name;
  const aside = p.required ? <span className="text-[11px] font-medium tracking-[.02em] text-fg-3">Required</span> : undefined;
  const value = shown(p, own);
  if (p.type === TemplateParameter_Type.LIST) {
    const ticked = value.split(",").filter(Boolean);
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="type-small font-semibold">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {p.values.map((v) => (
            <label key={v} className="flex items-center gap-1.5 type-small">
              <input
                type="checkbox"
                className="size-4 accent-ember"
                checked={ticked.includes(v)}
                onChange={(e) => onChange(p.values.filter((x) => (x === v ? e.target.checked : ticked.includes(x))).join(","))}
              />
              {v}
            </label>
          ))}
        </div>
        {p.description ? <span className="type-small text-fg-2">{p.description}</span> : null}
      </fieldset>
    );
  }
  if (p.type === TemplateParameter_Type.BOOL) {
    return (
      <label className="flex items-center gap-2">
        <input id={id} type="checkbox" className="size-4 accent-ember" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
        <span>
          <span className="type-small font-semibold">{label}</span>
          {p.description ? <span className="block type-small text-fg-2">{p.description}</span> : null}
        </span>
      </label>
    );
  }
  if (p.type === TemplateParameter_Type.ENUM) {
    return (
      <Field id={id} label={label} aside={aside} hint={p.description}>
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {p.required ? null : <option value="">{p.defaultValue ? `The default (${p.defaultValue})` : "Not set"}</option>}
          {p.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field
      id={id}
      label={label}
      aside={aside}
      error={error}
      hint={
        <>
          {p.description ? `${p.description.replace(/[.\s]+$/, "")}. ` : null}
          {/* A default may be written in the template's own syntax ("{% .Repo.Name %}"): say what it does, not how. */}
          {!p.defaultValue ? null : p.defaultValue.includes("{%") ? (
            "Left empty, the template works it out from the repo."
          ) : (
            <>
              Left empty, it is <span className="font-mono text-[12px]">{p.defaultValue}</span>.
            </>
          )}
        </>
      }
    >
      <input
        id={id}
        className={`${inputClass} font-mono`}
        inputMode={p.type === TemplateParameter_Type.INT ? "numeric" : undefined}
        value={value}
        placeholder={p.placeholder || undefined}
        onChange={(e) => onChange(e.target.value)}
        required={p.required}
        aria-invalid={!!error}
        aria-describedby={`${id}-note`}
      />
    </Field>
  );
}

// Create a service from a template: the API renders the template, creates the
// repo, pushes the first commit and registers the service, and the page shows
// each step as it happens.
// Create a service from a template: the API renders the template, creates the
// repo, pushes the first commit and registers the service, and the page shows
// each step as it happens. initial picks the template a link named ("go-grpc");
// fixed is a template's own create page, where the template is not a choice.
export function CreateService({ initial, fixed }: { initial?: string | null; fixed?: string }) {
  const api = useApi();
  const queries = useQueryClient();
  const canWrite = useCanWrite();
  const toast = useToast();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.templates.listTemplates({}).then((r) => r.templates),
  });

  const [name, setName] = useState("");
  // "Use template" on a template's card opens this page with it chosen.
  const [picked, setPicked] = useState(() => {
    const t = fixed ?? initial;
    return t ? `templates/${t}` : "";
  });
  // The owner of a service is a team of the GitHub organization, picked from the teams that exist.
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.teams.listTeams({}).then((r) => r.teams),
  });
  const [team, setTeam] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  // What was wrong with each input at the last press of Create, until it is edited.
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});
  // The run options as typed, per template: switching templates keeps each one's.
  const [runs, setRuns] = useState<Record<string, RunForm>>({});
  // No public address: forge.yaml gets run.domain: none.
  const [networkOnly, setNetworkOnly] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The idempotency key of the create in hand, and what it was for. The API
  // replays the outcome of a create to a retry with the same key, so the key
  // is kept until the API has given a definite answer or the request changes.
  const attempt = useRef<{ key: string; request: string } | null>(null);

  const template = templates.data?.find((t) => t.name === picked) ?? (fixed ? undefined : templates.data?.[0]);
  const own = (p: TemplateParameter) => params[`${template?.name}/${p.name}`];
  const run = (template && runs[template.name]) || emptyRunForm;
  const runAsked = runOptions(run, template?.options ?? []);
  const badName = checked && !SERVICE_NAME.test(name);
  const badTeam = checked && !team.trim();
  const problems = (template?.parameters ?? []).flatMap((p): [TemplateParameter, string][] => {
    const problem = paramProblem(p, sent(p, own(p)));
    return problem ? [[p, problem]] : [];
  });
  const required = template?.parameters.filter((p) => p.required) ?? [];
  const optional = template?.parameters.filter((p) => !p.required) ?? [];
  // A file template is a form: its inputs in its own order, under their groups.
  const isFile = template?.type === "file";
  const groups = [...new Set((template?.parameters ?? []).map((p) => p.group))];
  const field = (p: TemplateParameter) => {
    const key = `${template?.name}/${p.name}`;
    return (
      <ParameterField
        key={key}
        p={p}
        own={own(p)}
        error={paramErrors[key]}
        onChange={(v) => {
          setParams((all) => ({ ...all, [key]: v }));
          setParamErrors((all) => {
            const rest = { ...all };
            delete rest[key];
            return rest;
          });
        }}
      />
    );
  };
  // The command that does the same, flag by flag, as the form is filled in.
  const flags: [string, string][] = [
    ["--template", template ? templateId(template.name) : "<template>"],
    ["--team", team.trim() || "<team>"],
    ...(template?.parameters ?? []).flatMap((p): [string, string][] => {
      const value = sent(p, own(p));
      if (value === undefined) return p.required ? [["--set", `${p.name}=<${p.name}>`]] : [];
      return [["--set", `${p.name}=${value}`]];
    }),
    ...runAsked.flags,
    ...(networkOnly && !isFile ? [["--network-only", ""] as [string, string]] : []),
  ];

  async function create() {
    if (!template) return;
    setBusy(true);
    setSteps([]);
    setOutcome(null);
    const parameters: Record<string, string> = {};
    for (const p of template.parameters) {
      const value = sent(p, own(p));
      if (value !== undefined) parameters[p.name] = value;
    }
    const request = {
      serviceId: name,
      template: template.name,
      ownerTeam: team.trim(),
      parameters,
      runOptions: networkOnly && !isFile ? { ...runAsked.options, networkOnly: true } : runAsked.options,
    };
    const signature = JSON.stringify(request);
    if (attempt.current?.request !== signature) attempt.current = { key: randomString(), request: signature };
    const requestId = attempt.current.key;

    let list: Step[] = [];
    const show = (step: Step) => {
      const at = list.findIndex((s) => s.key === step.key);
      if (at >= 0) list[at] = step;
      else list.push(step);
      setSteps([...list]);
    };
    // Whatever was still turning when the stream ended did not finish here.
    const settle = () => {
      list = list.map((s) => (s.tone === "progress" ? { ...s, tone: "neutral" as const } : s));
      setSteps([...list]);
    };

    let ended: Outcome | null = null;
    // A stream that drops says nothing about the create: the API keeps working.
    // Ask once more with the same key, which replays what happened.
    for (let round = 0; round < 2 && !ended; round++) {
      try {
        for await (const msg of api.catalog.createService({ ...request, requestId })) {
          const event = msg.event;
          if (event.case === "step") {
            const [doing, did] = words[event.value.name] ?? [event.value.name, event.value.name];
            const isDone = event.value.state === CreateStep_State.DONE;
            show({
              key: event.value.name,
              tone: isDone ? "success" : "progress",
              text: isDone ? `${did} ${event.value.detail}`.trim() : doing,
            });
          } else if (event.case === "service") {
            ended = { service: event.value };
          } else if (event.case === "change") {
            ended = { change: event.value };
          } else if (event.case === "failure") {
            show({ key: event.value.step, tone: "danger", text: `${(words[event.value.step] ?? [event.value.step])[0]} failed` });
            ended = { failure: event.value };
          }
        }
      } catch (err) {
        if (REFUSED.includes(ConnectError.from(err).code)) ended = { error: err };
      }
      if (!ended && round === 0) show({ key: "reconnect", tone: "neutral", text: "The connection dropped. Asking Forge what happened." });
    }
    settle();
    if (ended) {
      // A definite answer: the next create is a new one.
      attempt.current = null;
      setOutcome(ended);
      if (ended.service) void queries.invalidateQueries({ queryKey: ["services"] });
    } else {
      setOutcome({
        error: new Error(
          "Forge could not be reached, and the create may still be finishing. Look for the service in the catalog, then press Create service again: it picks up the same create, it does not start a second one.",
        ),
      });
    }
    setBusy(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (template) {
      setParamErrors(Object.fromEntries(problems.map(([p, problem]) => [`${template.name}/${p.name}`, problem])));
    }
    if (problems.length > 0) {
      const first = document.getElementById(`param-${problems[0][0].name}`);
      const details = first?.closest("details");
      if (details) details.open = true;
      first?.focus();
      toast(problems.length === 1 ? "One input needs fixing" : `${problems.length} inputs need fixing`);
      return;
    }
    if (SERVICE_NAME.test(name) && team.trim() && !busy) void create();
  }

  if (outcome?.change) {
    const ch = outcome.change;
    return (
      <>
        <PageHeader
          title={`Pull request opened for ${name}`}
          lead={`It adds ${ch.files.length === 1 ? "one file" : `${ch.files.length} files`} to ${ch.repoUrl.replace("https://github.com/", "")}. Review and merge it there.`}
          cli={`forge create ${name} --template ${template ? templateId(template.name) : "<template>"}`}
        />
        <Panel>
          <StepLog steps={steps} />
        </Panel>
        <ul aria-label="Files" className="flex flex-col gap-1 font-mono text-[12.5px]">
          {ch.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p>
          <Addr href={ch.pullRequestUrl} />
        </p>
      </>
    );
  }

  if (outcome?.service) {
    const id = serviceId(outcome.service.name);
    return (
      <>
        <PageHeader
          title={`${id} was created`}
          lead="Its CI is running: it tests the code, builds the image and deploys it to staging."
          cli={`forge service get ${id}`}
        />
        <Panel>
          <StepLog steps={steps} />
        </Panel>
        <p className="flex flex-wrap items-center gap-4">
          <TextLink href={`/services/${id}`}>Open {id}</TextLink>
          {outcome.service.repoUrl ? <Addr href={outcome.service.repoUrl} /> : null}
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={fixed ? `Use ${fixed}` : "Create a service"}
        crumbs={
          fixed ? (
            <Crumbs>
              <Link href="/templates">Templates</Link>
              <span>/</span>
              <Link href={`/templates/${fixed}`}>{fixed}</Link>
            </Crumbs>
          ) : undefined
        }
        lead={
          isFile
            ? "Forge renders the template's files and opens a pull request that adds them."
            : "Forge makes the repo from a template, starts its CI and adds it to the catalog."
        }
        cli={`forge create ${name || "<name>"} --template ${template ? templateId(template.name) : "<template>"} --team ${team.trim() || "<team>"}`}
      />
      {!canWrite ? <p className="text-fg-2">Only writers can create a service. Ask platform-engineering for access.</p> : null}
      {templates.isPending ? (
        <Loading what="templates" />
      ) : templates.error ? (
        <ErrorNote error={templates.error} />
      ) : fixed && !template ? (
        <ErrorNote error={new Error(`There is no template ${fixed} in the newest release. See the templates for the ones there are.`)} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <div className="flex flex-col gap-4">
            <Field
              id="service-name"
              label={isFile ? "Name" : "Service name"}
              hint={
                isFile
                  ? "Lowercase letters, digits and hyphens. The template puts it in the file names."
                  : "Lowercase letters, digits and hyphens. This becomes the repo name."
              }
              error={badName ? "Use lowercase letters, digits and hyphens only, at most 63." : undefined}
            >
              <input
                id="service-name"
                className={`${inputClass} font-mono`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setChecked(true)}
                aria-invalid={badName}
                aria-describedby="service-name-note"
                placeholder="payments-api"
              />
            </Field>
            <Field
              id="service-template"
              label="Template"
              hint={
                template
                  ? `${template.title || template.description}. ${isFile ? `It opens a pull request in ${template.targetRepo}; no repo is made. ` : ""}${paramSummary(template.parameters)}${optional.length > 0 ? `, ${optional.length} optional` : ""}.`
                  : undefined
              }
            >
              {fixed ? (
                <input id="service-template" className={`${inputClass} font-mono`} readOnly value={template ? `${templateId(template.name)} (${template.version})` : fixed} />
              ) : (
                <select id="service-template" className={inputClass} value={template?.name ?? ""} onChange={(e) => setPicked(e.target.value)}>
                  {templates.data.map((t) => (
                    <option key={t.name} value={t.name}>
                      {templateId(t.name)} ({t.version})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {template && template.parameters.length > 0 && isFile ? (
              <div key={template.name} className="flex min-w-0 max-w-[420px] flex-col gap-4">
                {groups.map((g) =>
                  g ? (
                    <fieldset key={g} className="flex flex-col gap-4 rounded-md border border-line p-4">
                      <legend className="-ml-1.5 px-1.5 type-small font-semibold">{g}</legend>
                      {template.parameters.filter((p) => p.group === g).map(field)}
                    </fieldset>
                  ) : (
                    template.parameters.filter((p) => !p.group).map(field)
                  ),
                )}
              </div>
            ) : template && template.parameters.length > 0 ? (
              <fieldset key={template.name} className="flex min-w-0 max-w-[420px] flex-col gap-4 rounded-md border border-line p-4">
                <legend className="-ml-1.5 px-1.5 type-small font-semibold">
                  <span className="font-mono">{templateId(template.name)}</span> inputs
                </legend>
                {required.map(field)}
                {optional.length > 0 ? (
                  <details open={required.length === 0}>
                    <summary className="cursor-pointer type-small font-medium text-fg-2">
                      Optional <span className="tabular-nums text-fg-3">{optional.length}</span>
                    </summary>
                    <div className="flex flex-col gap-4 pt-3">{optional.map(field)}</div>
                  </details>
                ) : null}
              </fieldset>
            ) : null}
            {teams.error ? (
              // The list could not be read (the API says why): the team can still be typed, as on the CLI.
              <>
                <ErrorNote error={teams.error} />
                <Field
                  id="service-team"
                  label="Owner"
                  hint="The GitHub team that owns the service, by its name on GitHub."
                  error={badTeam ? "Name the team that owns the service." : undefined}
                >
                  <input
                    id="service-team"
                    className={`${inputClass} font-mono`}
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    aria-invalid={badTeam}
                    aria-describedby="service-team-note"
                    placeholder="platform-engineering"
                  />
                </Field>
              </>
            ) : (
              <Field
                id="service-team"
                label={isFile ? "GitHub team" : "Owner"}
                hint={isFile ? "The GitHub team the template gives access." : "The GitHub team that owns the service."}
                error={badTeam ? "Choose the team that owns the service." : undefined}
              >
                <select
                  id="service-team"
                  className={inputClass}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  aria-invalid={badTeam}
                  aria-describedby="service-team-note"
                  disabled={teams.isPending}
                >
                  <option value="" disabled>
                    {teams.isPending ? "Loading the teams from GitHub" : "Choose a team"}
                  </option>
                  {(teams.data ?? []).map((t) => {
                    const slug = teamId(t.name);
                    return (
                      <option key={t.name} value={slug}>
                        {t.displayName && t.displayName !== slug ? `${slug} (${t.displayName})` : slug}
                      </option>
                    );
                  })}
                </select>
              </Field>
            )}
            {template && !isFile ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-ember" checked={networkOnly} onChange={(e) => setNetworkOnly(e.target.checked)} />
                <span>
                  <span className="type-small font-semibold">Only on our network</span>
                  <span className="block type-small text-fg-2">
                    No public address: it is reached on the internal one, over HTTP. Change it later in forge.yaml (run.domain).
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {template && template.options.length > 0 ? (
            <Section title="How it runs" note="optional; change it later in forge.yaml">
              <RunOptionsFields
                offered={template.options}
                form={run}
                onChange={(f) => setRuns((all) => ({ ...all, [template.name]: f }))}
              />
            </Section>
          ) : null}

          <div className="flex max-w-[640px] flex-col gap-1.5">
            <span className="text-[12px] text-fg-3">From the terminal</span>
            <CommandBlock command={`forge create ${name || "<name>"}`} flags={flags} />
          </div>

          {steps.length > 0 ? (
            <Panel>
              <StepLog steps={steps} />
            </Panel>
          ) : null}
          {outcome?.failure ? (
            <ErrorNote
              error={
                new Error(
                  `${outcome.failure.message} ${
                    outcome.failure.rolledBack
                      ? "Nothing was left behind: fix it and create again."
                      : "The repo could not be deleted: delete it on GitHub before trying again."
                  }`,
                )
              }
            />
          ) : null}
          {outcome?.error ? <ErrorNote error={outcome.error} /> : null}

          <div>
            <Button kind="primary" type="submit" disabled={busy || !canWrite || !template}>
              {busy ? "Creating" : isFile ? "Create pull request" : "Create service"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
