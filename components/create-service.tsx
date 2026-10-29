"use client";

import { Code, ConnectError } from "@connectrpc/connect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePermissions } from "@/components/app-shell";
import { OperationLog, StepLog, type Step } from "@/components/operation-log";
import { useApi } from "@/components/providers";
import { emptyRunForm, RUN_OPTIONS, RunOptionsFields, runOptions, type RunForm } from "@/components/run-options";
import { Addr, Button, ButtonLink, TextLink } from "@/components/ui/button";
import { CommandBlock } from "@/components/ui/cli";
import { Field, inputClass } from "@/components/ui/field";
import { Crumbs, ErrorNote, Loading, PageHeader, Panel } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { CreateStep_State, type Service } from "@/gen/forge/v1/catalog_pb";
import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";
import { errorText, serviceId, teamId, templateId } from "@/lib/api";
import { randomString } from "@/lib/auth/pkce";
import { paramProblem, paramSummary } from "@/lib/params";

const SERVICE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// The steps of a create, in the words of the CLI: what is happening, then what was done.
const words: Record<string, [doing: string, done: string]> = {
  fetch: ["Fetching the template", "Fetched template"],
  render: ["Rendering the files", "Rendered"],
  create_repo: ["Creating the repo", "Created"],
  grant_team: ["Giving the team access", "Gave access to"],
  push: ["Pushing the first commit", "Pushed the first commit"],
  register: ["Registering the service", "Registered"],
  pull_request: ["Opening the pull request", "Opened"],
  check_image: ["Checking the image", "Checked the image:"],
  write_manifest: ["Writing forge.yaml", "Wrote forge.yaml to the"],
};

type Change = { repoUrl: string; branch: string; pullRequestUrl: string; files: string[] };
type Outcome = {
  service?: Service;
  change?: Change;
  failure?: { step: string; message: string; rolledBack: boolean };
  error?: unknown;
  // After a create from an image: the deploy to staging, or why it did not start.
  deploy?: string;
  deployError?: unknown;
};

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

// The steps of the form, in order. A file template makes no service, so it
// has no runtime to choose; a fixed template is not a choice. From an image,
// the first step is the image, and there are no template inputs.
type Stage = "template" | "details" | "inputs" | "runtime" | "review";
const stageNames: Record<Stage, string> = {
  template: "Template",
  details: "Name and owner",
  inputs: "Template inputs",
  runtime: "How it runs",
  review: "Review",
};

// Where a new service starts from: a template (a new repo) or an image someone
// else built (no repo; its forge.yaml is kept in the deploy repo).
type Source = "template" | "image";
const sources: { value: Source; title: string; text: string }[] = [
  { value: "template", title: "From a template", text: "Forge makes a repo from a template, with the CI that builds and deploys it." },
  {
    value: "image",
    title: "From an image",
    text: "Run an image someone else built, that runs as a non-root user. No repo: its forge.yaml is kept in the deploy repo.",
  },
];
// An image reference has no spaces; its tag and the registry are the API's to check.
const IMAGE = /^\S+$/;

// Who can reach a service. Internal is the cluster's internal address, over
// HTTP: forge.yaml's run.domain: none, or run.staging.public: false for
// staging alone.
type Reach = "public" | "internal-staging" | "internal";
const reaches: { value: Reach; title: string; text: string }[] = [
  { value: "public", title: "Public", text: "Staging and production both get a public HTTPS address." },
  {
    value: "internal-staging",
    title: "Internal staging",
    text: "Production is public. Staging is reachable only inside the cluster, over HTTP.",
  },
  {
    value: "internal",
    title: "Internal",
    text: "No public address. Both environments are reachable only inside the cluster, over HTTP.",
  },
];
const ENVS = ["staging", "production"] as const;
const sub = "text-[11.5px] font-semibold tracking-[.06em] text-fg-3 uppercase";

// A short mark for a template's card: the part of its name that says what it is.
function mark(id: string): string {
  const known: Record<string, string> = { "go-grpc": "gRPC", nextjs: "WEB", opentofu: "IaC", image: "IMG" };
  return known[id] ?? (id.split("-").at(-1) ?? id).slice(0, 4).toUpperCase();
}

function Mark({ id }: { id: string }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 font-mono text-[12px] font-semibold text-fg-2"
    >
      {mark(id)}
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

// The radio cards of the template and reach steps: the input is hidden, the
// card shows the choice, and the keyboard focus rings the card.
const card =
  "relative flex cursor-pointer gap-3 rounded-md border border-line bg-surface hover:border-fg-3 has-[:checked]:border-ember has-[:checked]:bg-[color-mix(in_oklab,var(--ember)_5%,var(--surface))] has-[:checked]:shadow-[0_0_0_1px_var(--ember)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ember";
const hiddenRadio = "pointer-events-none absolute opacity-0";

// Create a service from a template: the API renders the template, creates the
// repo, pushes the first commit and registers the service, and the page shows
// each step as it happens. initial picks the template a link named ("go-grpc");
// fixed is a template's own create page, where the template is not a choice.
// Or from an image: the API checks the image, writes its forge.yaml into the
// deploy repo and registers the service, and the page then deploys it to
// staging, as forge create --image does.
export function CreateService({ initial, fixed }: { initial?: string | null; fixed?: string }) {
  const api = useApi();
  const queries = useQueryClient();
  const canCreate = usePermissions().can("service.create");
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
  // The caller's own teams come first in the list: those are the ones they may create for.
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.auth.getStatus({}), staleTime: 5 * 60_000 });
  const mine = status.data?.teams ?? [];
  const teamList = [...(teams.data ?? [])].sort((a, b) => Number(mine.includes(teamId(b.name))) - Number(mine.includes(teamId(a.name))));
  // Whether the caller may create a service of the chosen team: a team's
  // members create its services, an admin those of any team.
  const forTeam = useQuery({
    queryKey: ["can-team", team.trim()],
    queryFn: () => api.auth.testPermissions({ ownerTeam: team.trim(), actions: ["service.create"] }),
    enabled: !!team.trim(),
    staleTime: 5 * 60_000,
  });
  const teamRefused = !!team.trim() && !!forTeam.data && !forTeam.data.allowed.includes("service.create");
  const refusedNote = `You can only create services for teams you are in. Ask platform-engineering to create it for ${team.trim()}.`;
  const [params, setParams] = useState<Record<string, string>>({});
  // What was wrong with each input at the last check, until it is edited.
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});
  // The run options as typed, per template: switching templates keeps each one's.
  const [runs, setRuns] = useState<Record<string, RunForm>>({});
  // A link that names a template, or a template's own page, starts from a template.
  const [source, setSource] = useState<Source>("template");
  const fromImage = !fixed && source === "image";
  const [image, setImage] = useState("");
  const [port, setPort] = useState("");
  const [health, setHealth] = useState("");
  // Folders it writes besides /tmp, comma-separated as typed: forge.yaml's run.writable.
  const [writable, setWritable] = useState("");
  const [imageChecked, setImageChecked] = useState(false);
  const [deployNow, setDeployNow] = useState(true);
  const [reach, setReach] = useState<Reach>("public");
  // The public domains the API offers, the default first, and the domain of
  // the internal addresses. An API that predates the list gives no choice:
  // the service gets the default.
  const domains = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.deploys.listDomains({}).then((r) => ({ names: r.domains.map((d) => d.name), internal: r.internalDomain })),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const domainList = domains.data?.names ?? [];
  const [domainPick, setDomainPick] = useState("");
  const defaultDomain = domainList[0] ?? "";
  const domain = domainList.includes(domainPick) ? domainPick : defaultDomain;
  const choosesDomain = domainList.length > 1 && reach !== "internal";
  // An API with no public domain at all makes every service internal.
  const nothingPublic = domains.isSuccess && domainList.length === 0;
  // A link that names the template starts at the details: the choice is made.
  const [stage, setStage] = useState<Stage>(fixed || initial ? "details" : "template");
  const [reached, setReached] = useState<Set<Stage>>(() => new Set([fixed || initial ? "details" : "template"]));
  // The heading of the step takes the focus when the writer moves to another step.
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = false;
  }, [stage]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The idempotency key of the create in hand, and what it was for. The API
  // replays the outcome of a create to a retry with the same key, so the key
  // is kept until the API has given a definite answer or the request changes.
  const attempt = useRef<{ key: string; request: string } | null>(null);

  const template = templates.data?.find((t) => t.name === picked) ?? (fixed ? undefined : templates.data?.[0]);
  const tplId = template ? templateId(template.name) : "";
  const own = (p: TemplateParameter) => params[`${template?.name}/${p.name}`];
  // The run options as typed: an image's are kept under "image".
  const runKey = fromImage ? "image" : template?.name;
  const run = (runKey && runs[runKey]) || emptyRunForm;
  // An image may set every run option; a template only those it offers.
  const offered = fromImage ? RUN_OPTIONS : (template?.options ?? []);
  const runAsked = runOptions(run, offered);
  const portNumber = Number(port.trim());
  const badImage = imageChecked && !IMAGE.test(image.trim());
  const badPort = imageChecked && !!port.trim() && !(Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535);
  const badHealth = imageChecked && !!health.trim() && !health.trim().startsWith("/");
  const folders = writable.split(",").map((f) => f.trim()).filter(Boolean);
  // The API checks the rest (not /tmp, /proc and the like); here, that each is a path.
  const writableOk = folders.every((f) => f.startsWith("/"));
  const badWritable = imageChecked && !writableOk;
  const badName = checked && !SERVICE_NAME.test(name);
  const badTeam = checked && !team.trim();
  const problems = (fromImage ? [] : (template?.parameters ?? [])).flatMap((p): [TemplateParameter, string][] => {
    const problem = paramProblem(p, sent(p, own(p)));
    return problem ? [[p, problem]] : [];
  });
  const required = template?.parameters.filter((p) => p.required) ?? [];
  const optional = template?.parameters.filter((p) => !p.required) ?? [];
  // A file template is a form: its inputs in its own order, under their groups.
  const isFile = !fromImage && template?.type === "file";
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
  // Where it is reached: a file template makes no service.
  const reachRun = isFile
    ? { flags: [] as [string, string][], options: {} }
    : reach === "internal"
      ? { flags: [["--internal", ""]] as [string, string][], options: { networkOnly: true } }
      : reach === "internal-staging"
        ? { flags: [["--internal-staging", ""]] as [string, string][], options: { stagingNetworkOnly: true } }
        : { flags: [] as [string, string][], options: {} };
  // The default domain is left to the API, as forge.yaml leaves it.
  const ownDomain = !isFile && choosesDomain && domain !== defaultDomain;
  const address = ownDomain
    ? { flags: [...reachRun.flags, ["--domain", domain]] as [string, string][], options: { ...reachRun.options, domain } }
    : reachRun;
  // Where the service will be reached in an environment, as forge-api works it
  // out: <name>-staging.<domain> and <name>.<domain> in public, and
  // <name>.<env>.<internal domain> inside. An API too old to name its internal
  // domain gets a placeholder.
  const addressOf = (env: (typeof ENVS)[number]) => {
    const n = name || "<name>";
    const inside = nothingPublic || reach === "internal" || (reach === "internal-staging" && env === "staging");
    if (inside) return `http://${n}.${env}.${domains.data?.internal || "<internal-domain>"}`;
    const d = domain || "<domain>";
    return env === "staging" ? `https://${n}-staging.${d}` : `https://${n}.${d}`;
  };
  // The command that does the same, flag by flag, as the form is filled in.
  const imageFlags: [string, string][] = [
    ["--image", image.trim() || "<image>"],
    ...(port.trim() ? ([["--port", port.trim()]] as [string, string][]) : []),
    ...(health.trim() ? ([["--health", health.trim()]] as [string, string][]) : []),
    ...(folders.length ? ([["--writable", folders.join(",")]] as [string, string][]) : []),
    ["--team", team.trim() || "<team>"],
    ...runAsked.flags,
    ...address.flags,
    ...(deployNow ? [] : ([["--deploy=false", ""]] as [string, string][])),
  ];
  const flags: [string, string][] = fromImage
    ? imageFlags
    : [
    ["--template", tplId || "<template>"],
    ["--team", team.trim() || "<team>"],
    ...(template?.parameters ?? []).flatMap((p): [string, string][] => {
      const value = sent(p, own(p));
      if (value === undefined) return p.required ? [["--set", `${p.name}=<${p.name}>`]] : [];
      return [["--set", `${p.name}=${value}`]];
    }),
    ...runAsked.flags,
    ...address.flags,
  ];

  async function create() {
    if (!fromImage && !template) return;
    setBusy(true);
    setSteps([]);
    setOutcome(null);
    const parameters: Record<string, string> = {};
    for (const p of fromImage ? [] : (template?.parameters ?? [])) {
      const value = sent(p, own(p));
      if (value !== undefined) parameters[p.name] = value;
    }
    const runAndAddress = Object.keys(address.options).length > 0 ? { ...runAsked.options, ...address.options } : runAsked.options;
    const imageRun = {
      ...(port.trim() ? { port: portNumber } : {}),
      ...(health.trim() ? { health: health.trim() } : {}),
      ...(folders.length ? { writable: folders } : {}),
    };
    const request = fromImage
      ? {
          serviceId: name,
          image: image.trim(),
          ownerTeam: team.trim(),
          runOptions: Object.keys(imageRun).length > 0 ? { ...runAndAddress, ...imageRun } : runAndAddress,
        }
      : {
          serviceId: name,
          template: template!.name,
          ownerTeam: team.trim(),
          parameters,
          runOptions: runAndAddress,
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
    if (ended?.service && fromImage && deployNow) {
      // As forge create --image: once the service is there, deploy it to staging.
      show({ key: "deploy", tone: "progress", text: "Starting the deploy to staging" });
      try {
        const res = await api.deploys.startDeploy({ service: ended.service.name, env: "staging", requestId: randomString() });
        show({ key: "deploy", tone: "success", text: "Started the deploy to staging" });
        ended = { ...ended, deploy: res.operation?.name };
      } catch (err) {
        show({ key: "deploy", tone: "danger", text: "The deploy to staging did not start" });
        ended = { ...ended, deployError: err };
      }
    }
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

  const stages: Stage[] = fromImage
    ? ["template", "details", "runtime", "review"]
    : [
        ...(fixed ? [] : (["template"] as const)),
        "details",
        "inputs",
        ...(template && !isFile && template.options.length > 0 ? (["runtime"] as const) : []),
        "review",
      ];
  const stageName = (s: Stage) => (s === "template" && fromImage ? "Image" : stageNames[s]);
  const at = Math.max(0, stages.indexOf(stage));

  // detailsOk checks the name and the owner, shows what is wrong and puts the focus on it.
  function detailsOk(): boolean {
    setChecked(true);
    if (!SERVICE_NAME.test(name)) {
      document.getElementById("service-name")?.focus();
      return false;
    }
    if (!team.trim() || teamRefused) {
      document.getElementById("service-team")?.focus();
      return false;
    }
    return true;
  }

  // inputsOk checks the template's inputs the same way.
  function inputsOk(): boolean {
    if (template) {
      setParamErrors(Object.fromEntries(problems.map(([p, problem]) => [`${template.name}/${p.name}`, problem])));
    }
    if (problems.length > 0) {
      document.getElementById(`param-${problems[0][0].name}`)?.focus();
      toast(problems.length === 1 ? "One input needs fixing" : `${problems.length} inputs need fixing`);
      return false;
    }
    return true;
  }

  // imageOk checks the image, its port and its health path.
  function imageOk(): boolean {
    setImageChecked(true);
    const bad = !IMAGE.test(image.trim())
      ? "service-image"
      : port.trim() && !(Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535)
        ? "service-port"
        : health.trim() && !health.trim().startsWith("/")
          ? "service-health"
          : !writableOk
            ? "service-writable"
            : "";
    if (bad) document.getElementById(bad)?.focus();
    return !bad;
  }

  const checks: [Stage, () => boolean][] = [
    ...(fromImage ? ([["template", imageOk]] as [Stage, () => boolean][]) : []),
    ["details", detailsOk],
    ["inputs", inputsOk],
  ];

  // go moves to a step. Nothing past a step is reached while that step is
  // wrong: the writer lands on the first one that is.
  function go(target: Stage) {
    const to = stages.indexOf(target);
    let landing = target;
    for (const [s, ok] of checks) {
      const i = stages.indexOf(s);
      if (to > i && at <= i && !ok()) {
        landing = s;
        break;
      }
    }
    if (landing !== stage) moved.current = true;
    setStage(landing);
    setReached((r) => new Set(r).add(landing));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (stage !== "review") {
      go(stages[at + 1]);
      return;
    }
    for (const [s, ok] of checks) {
      if (!ok()) {
        moved.current = true;
        setStage(s);
        return;
      }
    }
    if (!busy) void create();
  }

  if (outcome?.change) {
    const ch = outcome.change;
    return (
      <>
        <PageHeader
          title={`Pull request opened for ${name}`}
          lead={`It adds ${ch.files.length === 1 ? "one file" : `${ch.files.length} files`} to ${ch.repoUrl.replace("https://github.com/", "")}. Review and merge it there.`}
          cli={`forge create ${name} --template ${tplId || "<template>"}`}
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
          lead={
            !fromImage
              ? "Its CI is running: it tests the code, builds the image and deploys it to staging."
              : outcome.deploy
                ? "Forge is deploying it to staging. Production waits for your first promote."
                : outcome.deployError
                  ? "It is in the catalog, but its deploy to staging did not start."
                  : "It is in the catalog. Deploy it to staging from its page when you are ready."
          }
          cli={fromImage && outcome.deploy ? `forge deploy status ${id} --env staging` : `forge service get ${id}`}
        />
        <Panel>
          <StepLog steps={steps} />
        </Panel>
        {outcome.deploy ? (
          <section aria-label="Deploy to staging" className="flex flex-col gap-2">
            <h2 className="text-[14px] font-semibold">Deploy to staging</h2>
            <OperationLog name={outcome.deploy} />
          </section>
        ) : null}
        {outcome.deployError ? (
          <ErrorNote
            error={
              new Error(
                `${errorText(outcome.deployError)} Deploy it from its page, or run forge deploy start ${id} --env staging.`,
              )
            }
          />
        ) : null}
        <p className="flex flex-wrap items-center gap-4">
          <TextLink href={`/services/${id}`}>Open {id}</TextLink>
          {outcome.service.repoUrl ? <Addr href={outcome.service.repoUrl} /> : null}
        </p>
      </>
    );
  }

  const chosen = reaches.find((r) => r.value === reach)!;
  const mono = (v: string) => <span className="font-mono">{v}</span>;
  // The review: one block per step, each with the way back to it.
  const review: [Stage, string, [string, ReactNode][]][] = [
    ...(fromImage
      ? ([
          [
            "template",
            "Image",
            [
              ["Image", mono(image.trim())],
              ["Port", port.trim() ? mono(port.trim()) : <span className="text-fg-2">8080, the default</span>],
              ["Health", health.trim() ? mono(health.trim()) : <span className="text-fg-2">/healthz, the default</span>],
              ["Writable", folders.length ? mono(folders.join(", ")) : <span className="text-fg-2">/tmp only</span>],
            ],
          ],
        ] as [Stage, string, [string, ReactNode][]][])
      : []),
    ...(template && !fixed && !fromImage
      ? ([
          [
            "template",
            "Template",
            [
              [
                "Template",
                <>
                  {mono(tplId)} <span className="text-fg-3">{template.version}</span>
                </>,
              ],
            ],
          ],
        ] as [Stage, string, [string, ReactNode][]][])
      : []),
    [
      "details",
      "Name and owner",
      [
        ["Name", mono(name)],
        [isFile ? "GitHub team" : "Owner", team.trim()],
        ...(isFile
          ? []
          : ([
              ["Reach", chosen.title],
              ["Staging", mono(addressOf("staging"))],
              ["Production", mono(addressOf("production"))],
            ] as [string, ReactNode][])),
      ],
    ],
    ...(fromImage
      ? []
      : ([
          [
      "inputs",
      "Template inputs",
      (template?.parameters ?? []).length > 0
        ? (template?.parameters ?? []).map((p): [string, ReactNode] => {
            const value = sent(p, own(p));
            return [p.label || p.name, value === undefined ? <span className="text-fg-2">The template&apos;s default</span> : mono(value)];
          })
        : [["Inputs", "None"]],
          ],
        ] as [Stage, string, [string, ReactNode][]][])),
    ...(stages.includes("runtime")
      ? ([
          [
            "runtime",
            "How it runs",
            [
              [
                "Options",
                runAsked.flags.length > 0 ? (
                  <span className="flex flex-col gap-0.5 font-mono text-[12.5px]">
                    {runAsked.flags.map(([f, v], i) => (
                      <span key={i}>{`${f} ${v}`.trim()}</span>
                    ))}
                  </span>
                ) : (
                  <span className="text-fg-2">{fromImage ? "Forge's defaults" : "The template's defaults"}</span>
                ),
              ],
            ],
          ],
        ] as [Stage, string, [string, ReactNode][]][])
      : []),
  ];

  const cancel = fixed ? `/templates/${fixed}` : "/";

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
            : fromImage
              ? "Forge checks the image, keeps its forge.yaml in the deploy repo, adds it to the catalog and deploys it to staging."
              : "Forge makes the repo from a template, starts its CI and adds it to the catalog."
        }
      />
      {!canCreate ? <p className="text-fg-2">Only members of a team create services. Ask platform-engineering to add you to one.</p> : null}
      {templates.isPending ? (
        <Loading what="templates" />
      ) : templates.error ? (
        <ErrorNote error={templates.error} />
      ) : fixed && !template ? (
        <ErrorNote error={new Error(`There is no template ${fixed} in the newest release. See the templates for the ones there are.`)} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <nav aria-label="Steps">
            <ol className="flex gap-1.5 sm:gap-2">
              {stages.map((s, i) => {
                const current = i === at;
                const done = i < at;
                return (
                  <li key={s} className={current ? "min-w-0 flex-auto sm:flex-1" : "flex-none sm:min-w-0 sm:flex-1"}>
                    <button
                      type="button"
                      aria-current={current ? "step" : undefined}
                      disabled={!current && i > at && !reached.has(s)}
                      onClick={() => go(s)}
                      className={`group flex w-full items-center gap-2.5 border-t-[3px] px-1.5 py-2.5 text-left enabled:cursor-pointer disabled:cursor-not-allowed sm:px-3 ${
                        current ? "border-ember text-fg" : done ? "border-fg-2 text-fg-2" : "border-line text-fg-3"
                      }`}
                    >
                      <span
                        className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-[12px] font-semibold tabular-nums ${
                          current ? "border-ember bg-ember text-ember-on" : done ? "border-fg-2 bg-fg-2 text-bg" : "border-current"
                        }`}
                      >
                        {done ? <Check /> : i + 1}
                      </span>
                      <span
                        className={`truncate text-[13px] font-medium group-enabled:group-hover:underline ${current ? "" : "sr-only sm:not-sr-only"}`}
                      >
                        {stageName(s)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="grid items-start gap-8 min-[1080px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 max-w-[720px] flex-col gap-5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] text-fg-3">
                  Step {at + 1} of {stages.length}
                </span>
                <h2 ref={heading} tabIndex={-1} className="font-display text-[22px] font-bold outline-none [font-stretch:112%]">
                  {stageName(stage)}
                </h2>
              </div>

              {stage === "template" ? (
                <fieldset className="flex min-w-0 flex-col gap-3">
                  <legend className="mb-1.5 text-[13px] font-medium">Start from</legend>
                  <div role="radiogroup" aria-label="Start from" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                    {sources.map((o) => (
                      <label key={o.value} className={`${card} px-4 py-3`}>
                        <input
                          type="radio"
                          name="source"
                          value={o.value}
                          checked={source === o.value}
                          onChange={() => setSource(o.value)}
                          aria-labelledby={`source-${o.value}`}
                          aria-describedby={`source-${o.value}-about`}
                          className={hiddenRadio}
                        />
                        <span className="flex flex-col gap-0.5 text-[13px]">
                          <b id={`source-${o.value}`} className="text-[14px] font-semibold">
                            {o.title}
                          </b>
                          <span id={`source-${o.value}-about`} className="text-fg-2">
                            {o.text}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {stage === "template" && fromImage ? (
                <div className="flex max-w-[520px] flex-col gap-5">
                  <Field
                    id="service-image"
                    label="Image"
                    hint="With its tag, such as nginxinc/nginx-unprivileged:1.27. Not latest: Forge pins the tag to its digest. It must run as a non-root user, given by number."
                    error={badImage ? "Name the image and its tag, without spaces." : undefined}
                  >
                    <input
                      id="service-image"
                      className={`${inputClass} font-mono`}
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      aria-invalid={badImage}
                      aria-describedby="service-image-note"
                      placeholder="nginxinc/nginx-unprivileged:1.27"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    id="service-port"
                    label="Port"
                    hint="The port it listens on. Left empty, it is 8080."
                    error={badPort ? "Use a port from 1 to 65535." : undefined}
                  >
                    <input
                      id="service-port"
                      className={`${inputClass} font-mono`}
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      aria-invalid={badPort}
                      aria-describedby="service-port-note"
                      placeholder="8080"
                    />
                  </Field>
                  <Field
                    id="service-health"
                    label="Health path"
                    hint="The path Kubernetes asks to know it is ready. Left empty, it is /healthz."
                    error={badHealth ? "Start the path with /." : undefined}
                  >
                    <input
                      id="service-health"
                      className={`${inputClass} font-mono`}
                      value={health}
                      onChange={(e) => setHealth(e.target.value)}
                      aria-invalid={badHealth}
                      aria-describedby="service-health-note"
                      placeholder="/healthz"
                    />
                  </Field>
                  <Field
                    id="service-writable"
                    label="Writable folders"
                    hint="The filesystem is read-only except /tmp. Folders it writes besides, separated by commas; each starts empty."
                    error={badWritable ? "Give each folder as an absolute path, such as /var/cache/nginx." : undefined}
                  >
                    <input
                      id="service-writable"
                      className={`${inputClass} font-mono`}
                      value={writable}
                      onChange={(e) => setWritable(e.target.value)}
                      aria-invalid={badWritable}
                      aria-describedby="service-writable-note"
                      placeholder="/var/cache/nginx"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                </div>
              ) : null}

              {stage === "template" && !fromImage ? (
                <fieldset className="flex min-w-0 flex-col gap-3">
                  <legend className="sr-only">Template</legend>
                  <p className="text-[13.5px] text-fg-2">
                    The template sets the language, CI and deploy config. You can&apos;t change it after the service is created.
                  </p>
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                    {templates.data.map((t) => {
                      const id = templateId(t.name);
                      const file = t.type === "file";
                      const optionalCount = t.parameters.filter((p) => !p.required).length;
                      return (
                        <label key={t.name} className={`${card} p-4`}>
                          <input
                            type="radio"
                            name="template"
                            value={t.name}
                            checked={template?.name === t.name}
                            onChange={() => setPicked(t.name)}
                            aria-labelledby={`tpl-${id}`}
                            aria-describedby={`tpl-${id}-about`}
                            className={hiddenRadio}
                          />
                          <Mark id={id} />
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="flex flex-wrap items-baseline gap-2">
                              <span id={`tpl-${id}`} className="font-mono text-[14px] font-semibold">
                                {id}
                              </span>
                              <span className="font-mono text-[12px] tabular-nums text-fg-3">{t.version}</span>
                            </span>
                            <span id={`tpl-${id}-about`} className="flex flex-col gap-1">
                              {t.title ? <span className="text-[13px] font-semibold">{t.title}</span> : null}
                              <span className="text-[13px] text-fg-2">{t.description}</span>
                              {file ? <span className="text-[13px] text-fg-2">Opens a pull request in {t.targetRepo}; no repo is made.</span> : null}
                              <span className="text-[12px] text-fg-3">
                                {paramSummary(t.parameters)}
                                {optionalCount > 0 ? `, ${optionalCount} optional` : ""} · {file ? "Pull request" : "New repo"}
                              </span>
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {stage === "details" ? (
                <div className="flex max-w-[520px] flex-col gap-5">
                  {fixed ? (
                    <Field id="service-template" label="Template" hint={template ? template.title || template.description : undefined}>
                      <input
                        id="service-template"
                        className={`${inputClass} font-mono`}
                        readOnly
                        value={template ? `${tplId} (${template.version})` : fixed}
                      />
                    </Field>
                  ) : null}
                  <Field
                    id="service-name"
                    label={isFile ? "Name" : "Service name"}
                    hint={
                      isFile
                        ? "Lowercase letters, digits and hyphens. The template puts it in the file names."
                        : fromImage
                          ? "Lowercase letters, digits and hyphens. This becomes the catalog name and part of its address."
                          : "Lowercase letters, digits and hyphens. This becomes the repo name and the catalog name."
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
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  {teams.error ? (
                    // The list could not be read (the API says why): the team can still be typed, as on the CLI.
                    <>
                      <ErrorNote error={teams.error} />
                      <Field
                        id="service-team"
                        label="Owner"
                        hint="The GitHub team that owns the service, by its name on GitHub."
                        error={badTeam ? "Name the team that owns the service." : teamRefused ? refusedNote : undefined}
                      >
                        <input
                          id="service-team"
                          className={`${inputClass} font-mono`}
                          value={team}
                          onChange={(e) => setTeam(e.target.value)}
                          aria-invalid={badTeam || teamRefused}
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
                      error={badTeam ? "Choose the team that owns the service." : teamRefused ? refusedNote : undefined}
                    >
                      <select
                        id="service-team"
                        className={inputClass}
                        value={team}
                        onChange={(e) => setTeam(e.target.value)}
                        aria-invalid={badTeam || teamRefused}
                        aria-describedby="service-team-note"
                        disabled={teams.isPending}
                      >
                        <option value="" disabled>
                          {teams.isPending ? "Loading the teams from GitHub" : "Choose a team"}
                        </option>
                        {teamList.map((t) => {
                          const slug = teamId(t.name);
                          const label = t.displayName && t.displayName !== slug ? `${slug} (${t.displayName})` : slug;
                          return (
                            <option key={t.name} value={slug}>
                              {mine.includes(slug) ? `${label} · your team` : label}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                  )}
                  {(fromImage || template) && !isFile ? (
                    <fieldset className="flex min-w-0 flex-col gap-3">
                      <legend className="mb-1.5 text-[13px] font-medium">Who can reach it</legend>
                      <div role="radiogroup" aria-label="Who can reach it" className="flex flex-col gap-2">
                        {reaches.map((r) => (
                          <label
                            key={r.value}
                            className={`${card} px-4 py-3 before:absolute before:top-[15px] before:left-4 before:size-3.5 before:rounded-full before:border-[1.5px] before:border-line-strong before:bg-surface before:content-[''] has-[:checked]:before:border-[4.5px] has-[:checked]:before:border-ember`}
                          >
                            <input
                              type="radio"
                              name="reach"
                              value={r.value}
                              checked={reach === r.value}
                              onChange={() => setReach(r.value)}
                              aria-labelledby={`reach-${r.value}`}
                              aria-describedby={`reach-${r.value}-about`}
                              className={hiddenRadio}
                            />
                            <span className="flex flex-col gap-0.5 pl-[26px] text-[13px]">
                              <b id={`reach-${r.value}`} className="text-[14px] font-semibold">
                                {r.title}
                              </b>
                              <span id={`reach-${r.value}-about`} className="text-fg-2">
                                {r.text}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      {choosesDomain ? (
                        <Field id="service-domain" label="Domain" hint="The domain the public addresses are under. Ask platform-engineering for another.">
                          <select id="service-domain" className={inputClass} value={domain} onChange={(e) => setDomainPick(e.target.value)} aria-describedby="service-domain-note">
                            {domainList.map((d) => (
                              <option key={d} value={d}>
                                {d === defaultDomain ? `${d} (default)` : d}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                      <dl aria-label="Addresses" className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2.5 text-[12.5px]">
                        {ENVS.map((env) => (
                          <div key={env} className="flex min-w-0 gap-2.5">
                            <dt className="w-[74px] shrink-0 text-fg-3">{env}</dt>
                            <dd className="font-mono [overflow-wrap:anywhere]">{addressOf(env)}</dd>
                          </div>
                        ))}
                      </dl>
                      <span className="text-[12px] text-fg-3">
                        Change it later in forge.yaml (<span className="font-mono">run.domain</span> and{" "}
                        <span className="font-mono">run.staging.public</span>).
                      </span>
                    </fieldset>
                  ) : null}
                </div>
              ) : null}

              {stage === "inputs" && template && !fromImage ? (
                template.parameters.length === 0 ? (
                  <div className="rounded-md border border-dashed border-line-strong p-5">
                    <b>
                      <span className="font-mono">{tplId}</span> has no inputs.
                    </b>
                    <p className="mt-1 text-fg-2">
                      Nothing to fill in here. Continue to {stages.includes("runtime") ? "choose how it runs" : "the review"}.
                    </p>
                  </div>
                ) : isFile ? (
                  <div key={template.name} className="flex min-w-0 max-w-[520px] flex-col gap-5">
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
                ) : (
                  <div key={template.name} className="flex min-w-0 max-w-[520px] flex-col gap-5">
                    {required.length > 0 ? (
                      <section aria-labelledby="inputs-required" className="flex flex-col gap-4">
                        <h3 id="inputs-required" className={sub}>
                          Required
                        </h3>
                        {required.map(field)}
                      </section>
                    ) : (
                      <p className="text-fg-2">
                        <span className="font-mono">{tplId}</span> needs nothing from you. The optional inputs below already have sensible defaults.
                      </p>
                    )}
                    {optional.length > 0 ? (
                      <section aria-labelledby="inputs-optional" className="flex flex-col gap-4">
                        <h3 id="inputs-optional" className={sub}>
                          Optional
                        </h3>
                        {optional.map(field)}
                      </section>
                    ) : null}
                  </div>
                )
              ) : null}

              {stage === "runtime" && runKey ? (
                <>
                  <p className="text-[13.5px] text-fg-2">Everything here is optional and has a default. Change any of it later in forge.yaml.</p>
                  <RunOptionsFields offered={offered} form={run} onChange={(f) => setRuns((all) => ({ ...all, [runKey]: f }))} />
                </>
              ) : null}

              {stage === "review" ? (
                <div className="flex flex-col gap-4">
                  <ul aria-label="Review" className="flex flex-col gap-4">
                    {review.map(([s, title, rows]) => (
                      <li key={title} className="rounded-md border border-line bg-surface p-4">
                        <div className="mb-3 flex items-center gap-3">
                          <h3 className="text-[14px] font-semibold">{title}</h3>
                          <Button kind="quiet" size="sm" className="ml-auto" aria-label={`Edit ${title.toLowerCase()}`} onClick={() => go(s)}>
                            Edit
                          </Button>
                        </div>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
                          {rows.map(([label, value]) => (
                            <Fragment key={label}>
                              <dt className="text-fg-3">{label}</dt>
                              <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                  <div className="px-0.5">
                    <h3 className="text-[14px] font-semibold">What happens next</h3>
                    <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13.5px] text-fg-2">
                      {fromImage ? (
                        <>
                          <li>
                            Forge checks <span className="font-mono">{image.trim()}</span> against the image rules and pins its tag to the digest it has now.
                          </li>
                          <li>
                            It writes <span className="font-mono">services/{name}/forge.yaml</span> into the deploy repo and adds {name} to the catalog. No repo is made.
                          </li>
                          <li>{deployNow ? "It deploys it to staging." : "Nothing is deployed until you deploy it from its page."} Production waits for your first promote.</li>
                        </>
                      ) : isFile ? (
                        <>
                          <li>
                            Forge renders <span className="font-mono">{tplId}</span> and opens a pull request in{" "}
                            <span className="font-mono">{template?.targetRepo}</span>.
                          </li>
                          <li>Nothing changes until someone reviews and merges it.</li>
                        </>
                      ) : (
                        <>
                          <li>
                            Forge creates <span className="font-mono">github.com/showmino/{name}</span> from <span className="font-mono">{tplId}</span>.
                          </li>
                          <li>CI builds the first image and deploys it to staging.</li>
                          <li>The service appears in the catalog. Production waits for your first promote.</li>
                        </>
                      )}
                    </ol>
                    {fromImage ? (
                      <label className="mt-3 flex items-center gap-2">
                        <input type="checkbox" className="size-4 accent-ember" checked={deployNow} onChange={(e) => setDeployNow(e.target.checked)} />
                        <span className="type-small">Deploy it to staging once it is created</span>
                      </label>
                    ) : null}
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
                              : fromImage
                                ? `Its forge.yaml is still in the deploy repo (services/${name}/forge.yaml): the next create overwrites it.`
                                : "The repo could not be deleted: delete it on GitHub before trying again."
                          }`,
                        )
                      }
                    />
                  ) : null}
                  {outcome?.error ? <ErrorNote error={outcome.error} /> : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                {at > 0 ? (
                  <Button
                    onClick={() => {
                      moved.current = true;
                      setStage(stages[at - 1]);
                    }}
                    disabled={busy}
                  >
                    Back
                  </Button>
                ) : (
                  <ButtonLink kind="quiet" href={cancel}>
                    Cancel
                  </ButtonLink>
                )}
                {stage === "review" ? (
                  <Button kind="primary" type="submit" className="ml-auto" disabled={busy || !canCreate || teamRefused || (!fromImage && !template)}>
                    {busy ? "Creating" : isFile ? "Create pull request" : "Create service"}
                  </Button>
                ) : (
                  <Button kind="primary" type="submit" className="ml-auto" disabled={!fromImage && !template}>
                    Continue
                  </Button>
                )}
              </div>
            </div>

            <aside className="min-w-0 min-[1080px]:sticky min-[1080px]:top-[76px]">
              <Panel className="flex flex-col gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {fromImage ? <Mark id="image" /> : tplId ? <Mark id={tplId} /> : null}
                  <div className="min-w-0">
                    <div className="truncate font-mono font-semibold">{name || "<name>"}</div>
                    <div className="truncate text-[12.5px] text-fg-3">
                      {fromImage ? image.trim() || "<image>" : tplId || "<template>"} · {team.trim() || "No owner yet"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">From the terminal</span>
                  <CommandBlock command={`forge create ${name || "<name>"}`} flags={flags} />
                </div>
              </Panel>
            </aside>
          </div>
        </form>
      )}
    </>
  );
}

