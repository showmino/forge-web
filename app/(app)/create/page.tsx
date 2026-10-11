"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useCanWrite } from "@/components/app-shell";
import { StepLog, type Step } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { Button, TextLink } from "@/components/ui/button";
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

function ParameterField({ p, value, onChange }: { p: TemplateParameter; value: string; onChange: (v: string) => void }) {
  const id = `param-${p.name}`;
  const label = p.required ? p.name : `${p.name} (optional)`;
  if (p.type === TemplateParameter_Type.BOOL) {
    return (
      <label className="flex items-center gap-2">
        <input id={id} type="checkbox" className="size-4 accent-accent" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
        <span>
          <span className="type-small font-semibold">{p.name}</span>
          {p.description ? <span className="block type-small text-ink-muted">{p.description}</span> : null}
        </span>
      </label>
    );
  }
  return (
    <Field id={id} label={label} hint={p.description}>
      {p.type === TemplateParameter_Type.ENUM ? (
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {p.required ? null : <option value="">Not set</option>}
          {p.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={`${inputClass} type-code`}
          inputMode={p.type === TemplateParameter_Type.INT ? "numeric" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={p.required}
        />
      )}
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
  const [picked, setPicked] = useState("");
  const [team, setTeam] = useState("");
  const [owners, setOwners] = useState(() => loadSession()?.email ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const template = templates.data?.find((t) => t.name === picked) ?? templates.data?.[0];
  const value = (p: TemplateParameter) => params[`${template?.name}/${p.name}`] ?? p.defaultValue;
  const badName = checked && !SERVICE_NAME.test(name);

  async function create() {
    if (!template) return;
    setBusy(true);
    setSteps([]);
    setOutcome(null);
    const parameters: Record<string, string> = {};
    for (const p of template.parameters) if (value(p) !== "") parameters[p.name] = value(p);
    const list: Step[] = [];
    const show = (step: Step) => {
      const at = list.findIndex((s) => s.key === step.key);
      if (at >= 0) list[at] = step;
      else list.push(step);
      setSteps([...list]);
    };
    try {
      const stream = api.catalog.createService({
        serviceId: name,
        template: template.name,
        ownerTeam: team.trim(),
        owners: owners
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
        parameters,
        // A new key for each attempt: a retry after a fix must not replay the failure.
        requestId: randomString(),
      });
      let ended: Outcome = { error: new Error("Forge ended the create without a result. Check the catalog before trying again.") };
      for await (const msg of stream) {
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
      setOutcome(ended);
      if (ended.service) void queries.invalidateQueries({ queryKey: ["services"] });
    } catch (err) {
      setOutcome({ error: err });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (SERVICE_NAME.test(name)) void create();
  }

  if (outcome?.service) {
    const id = serviceId(outcome.service.name);
    return (
      <>
        <PageHeader title={`${id} was created`} lead="Its CI is running: it tests the code, builds the image and deploys it to staging." />
        <Panel>
          <StepLog steps={steps} />
        </Panel>
        <p className="flex flex-wrap gap-4">
          <TextLink href={`/services/${id}`}>Open {id}</TextLink>
          {outcome.service.repoUrl ? (
            <TextLink href={outcome.service.repoUrl} target="_blank" rel="noreferrer">
              Open the repo
            </TextLink>
          ) : null}
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Create a service" lead="Forge makes the repo from a template, starts its CI and adds it to the catalog." />
      {!canWrite ? <p className="text-ink-muted">Only writers can create a service. Ask platform-engineering for access.</p> : null}
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
                className={`${inputClass} type-code`}
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
                    value={value(p)}
                    onChange={(v) => setParams((all) => ({ ...all, [`${template.name}/${p.name}`]: v }))}
                  />
                ))}
              </div>
            </Section>
          ) : null}

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
