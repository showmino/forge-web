"use client";

import { Code, ConnectError } from "@connectrpc/connect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useCanWrite } from "@/components/app-shell";
import { StepLog, type Step } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { Addr, Button, TextLink } from "@/components/ui/button";
import { CommandBlock } from "@/components/ui/cli";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote, Loading, PageHeader, Panel, Section } from "@/components/ui/layout";
import { CreateStep_State, type Service } from "@/gen/forge/v1/catalog_pb";
import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";
import { serviceId, templateId } from "@/lib/api";
import { randomString } from "@/lib/auth/pkce";
import { loadSession } from "@/lib/auth/session";

const SERVICE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// The steps of a create, in the words of the CLI: what is happening, then what was done.
const words: Record<string, [doing: string, done: string]> = {
  fetch: ["Fetching the template", "Fetched template"],
  render: ["Rendering the files", "Rendered"],
  create_repo: ["Creating the repo", "Created"],
  push: ["Pushing the first commit", "Pushed the first commit"],
  register: ["Registering the service", "Registered"],
};

type Outcome = { service?: Service; failure?: { step: string; message: string; rolledBack: boolean }; error?: unknown };

// Answers after which the API did nothing more: the next attempt is a new create.
const REFUSED = [Code.InvalidArgument, Code.FailedPrecondition, Code.PermissionDenied, Code.Unauthenticated, Code.AlreadyExists, Code.NotFound];

// shown is what a parameter's control displays: the writer's own value, or the
// one that applies when they give none.
function shown(p: TemplateParameter, own: string | undefined): string {
  if (own !== undefined) return own;
  if (p.type === TemplateParameter_Type.BOOL) return p.defaultValue;
  // A required choice has no default: the first value is selected, and sent.
  if (p.type === TemplateParameter_Type.ENUM) return p.defaultValue || (p.required ? (p.values[0] ?? "") : "");
  return "";
}

// sent is what goes to the API for a parameter, or undefined to leave it to
// the template. A default is never sent back: the API hands it out as the
// template wrote it (it may refer to the repo, "github.com/{owner}/{name}")
// and fills it in only when the parameter is absent.
function sent(p: TemplateParameter, own: string | undefined): string | undefined {
  if (own !== undefined && own !== "") return own;
  if (own === undefined && p.type === TemplateParameter_Type.ENUM && p.required && !p.defaultValue) return p.values[0];
  return undefined;
}

function ParameterField({ p, own, onChange }: { p: TemplateParameter; own: string | undefined; onChange: (v: string) => void }) {
  const id = `param-${p.name}`;
  const label = p.required ? p.name : `${p.name} (optional)`;
  const value = shown(p, own);
  if (p.type === TemplateParameter_Type.BOOL) {
    return (
      <label className="flex items-center gap-2">
        <input id={id} type="checkbox" className="size-4 accent-ember" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
        <span>
          <span className="type-small font-semibold">{p.name}</span>
          {p.description ? <span className="block type-small text-fg-2">{p.description}</span> : null}
        </span>
      </label>
    );
  }
  if (p.type === TemplateParameter_Type.ENUM) {
    return (
      <Field id={id} label={label} hint={p.description}>
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
        onChange={(e) => onChange(e.target.value)}
        required={p.required}
      />
    </Field>
  );
}

// Create a service from a template: the API renders the template, creates the
// repo, pushes the first commit and registers the service, and the page shows
// each step as it happens.
export default function CreateService() {
  const api = useApi();
  const queries = useQueryClient();
  const canWrite = useCanWrite();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.templates.listTemplates({}).then((r) => r.templates),
  });

  const [name, setName] = useState("");
  // "Use template" on a template's card opens this page with it chosen.
  const [picked, setPicked] = useState(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("template");
    return t ? `templates/${t}` : "";
  });
  const [team, setTeam] = useState("");
  const [owners, setOwners] = useState(() => loadSession()?.email ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The idempotency key of the create in hand, and what it was for. The API
  // replays the outcome of a create to a retry with the same key, so the key
  // is kept until the API has given a definite answer or the request changes.
  const attempt = useRef<{ key: string; request: string } | null>(null);

  const template = templates.data?.find((t) => t.name === picked) ?? templates.data?.[0];
  const own = (p: TemplateParameter) => params[`${template?.name}/${p.name}`];
  const badName = checked && !SERVICE_NAME.test(name);
  const ownerList = owners
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // The command that does the same, flag by flag, as the form is filled in.
  const flags: [string, string][] = [
    ["--template", template ? templateId(template.name) : "<template>"],
    ["--team", team.trim() || "<team>"],
    ...ownerList.map((o): [string, string] => ["--owner", o]),
    ...(template?.parameters ?? []).flatMap((p): [string, string][] => {
      const value = sent(p, own(p));
      return value === undefined ? [] : [["--set", `${p.name}=${value}`]];
    }),
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
      owners: ownerList,
      parameters,
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
    if (SERVICE_NAME.test(name) && !busy) void create();
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
        title="Create a service"
        lead="Forge makes the repo from a template, starts its CI and adds it to the catalog."
        cli={`forge create ${name || "<name>"} --template ${template ? templateId(template.name) : "<template>"} --team ${team.trim() || "<team>"}`}
      />
      {!canWrite ? <p className="text-fg-2">Only writers can create a service. Ask platform-engineering for access.</p> : null}
      {templates.isPending ? (
        <Loading what="templates" />
      ) : templates.error ? (
        <ErrorNote error={templates.error} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <div className="flex flex-col gap-4">
            <Field
              id="service-name"
              label="Service name"
              hint="Lowercase letters, digits and hyphens. This becomes the repo name."
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
            <Field id="service-template" label="Template" hint={template?.description}>
              <select id="service-template" className={inputClass} value={template?.name ?? ""} onChange={(e) => setPicked(e.target.value)}>
                {templates.data.map((t) => (
                  <option key={t.name} value={t.name}>
                    {templateId(t.name)} ({t.version})
                  </option>
                ))}
              </select>
            </Field>
            <Field id="service-team" label="Team" hint="The team that owns the service.">
              <input id="service-team" className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="platform-engineering" />
            </Field>
            <Field id="service-owners" label="Owners" hint="Emails or handles, separated by commas.">
              <input id="service-owners" className={inputClass} value={owners} onChange={(e) => setOwners(e.target.value)} />
            </Field>
          </div>

          {template && template.parameters.length > 0 ? (
            <Section title={`What ${templateId(template.name)} asks for`}>
              <div className="flex flex-col gap-4">
                {template.parameters.map((p) => (
                  <ParameterField
                    key={`${template.name}/${p.name}`}
                    p={p}
                    own={own(p)}
                    onChange={(v) => setParams((all) => ({ ...all, [`${template.name}/${p.name}`]: v }))}
                  />
                ))}
              </div>
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
              {busy ? "Creating" : "Create service"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
