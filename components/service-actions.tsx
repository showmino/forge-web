"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote, Loading } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { Service } from "@/gen/forge/v1/catalog_pb";
import { Bump, type Deployment } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId } from "@/lib/api";
import { randomString } from "@/lib/auth/pkce";
import { shortCommit, when } from "@/lib/format";
import { deploymentStatus } from "@/lib/status";

// The actions taken on one service. Each is a dialog that names the
// target, says what will happen, and starts the work with the same verb as its
// title. The API decides whether the reader may do it.

type Started = (operation: string | undefined) => void;
type Common = { id: string; onClose: () => void; onStarted: Started };

const LIFETIMES = [
  [1, "1 hour"],
  [8, "8 hours"],
  [24, "1 day"],
  [72, "3 days"],
  [168, "7 days"],
] as const;

const hours = (h: number) => ({ seconds: BigInt(h * 3600) });

// useAction runs one call and keeps the dialog open with the reason when it fails.
function useAction<T>(call: () => Promise<T>, done: (result: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  function run(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    call().then(done, (err: unknown) => {
      setError(err);
      setBusy(false);
    });
  }
  return { run, busy, error };
}

function FactList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-surface-2 p-3">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-2">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const code = (text: string) => <span className="type-code">{text}</span>;

// built names a build: its version when it has one, and its commit.
const built = (r: { version: string; commit: string }) =>
  r.version ? `${r.version}, ${shortCommit(r.commit)}` : shortCommit(r.commit);

export function DeployDialog({ id, onClose, onStarted }: Common) {
  const api = useApi();
  const toast = useToast();
  const [ref, setRef] = useState("main");
  const [requestId] = useState(randomString);
  const action = useAction(
    () => api.deploys.startDeploy({ service: `services/${id}`, env: "staging", ref: ref.trim(), requestId }),
    (res) => {
      toast(`Deploying ${id} to staging`, `forge deploy start ${id} --env staging --ref ${ref.trim()}`);
      onStarted(res.operation?.name);
    },
  );
  return (
    <Dialog title={`Deploy ${id} to staging?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>Staging will run the image CI built for this commit.</p>
        <Field id="deploy-ref" label="Branch, tag or commit" hint="CI must have pushed an image for it.">
          <input id="deploy-ref" className={`${inputClass} type-code`} value={ref} onChange={(e) => setRef(e.target.value)} required />
        </Field>
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={action.busy}>
            Deploy to staging
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// How far a promotion raises the version; a patch unless someone picks more.
const BUMPS = [
  [Bump.PATCH, "Patch", "Bug fixes"],
  [Bump.MINOR, "Minor", "New features"],
  [Bump.MAJOR, "Major", "Breaking changes"],
] as const;

export function PromoteDialog({ id, staging, onClose, onStarted }: Common & { staging: Deployment | undefined }) {
  const api = useApi();
  const [bump, setBump] = useState<Bump>(Bump.PATCH);
  // The page may be old, and CI deploys to staging on every push: ask the API
  // now what a promote would put into production, and as which version, and
  // confirm that.
  const check = useQuery({
    queryKey: ["promote-check", id, bump],
    queryFn: () => api.deploys.promoteDeploy({ service: `services/${id}`, validateOnly: true, bump }).then((r) => r.deployment),
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
  const next = check.data;
  const moved = !!next?.commit && !!staging?.commit && next.commit !== staging.commit;
  // A commit that was released before keeps its version: nothing to pick.
  const released = !!next?.version && next.version === staging?.version;
  const toast = useToast();
  const action = useAction(
    () => api.deploys.promoteDeploy({ service: `services/${id}`, bump }),
    (res) => {
      const flag = bump === Bump.MINOR ? " --bump minor" : bump === Bump.MAJOR ? " --bump major" : "";
      toast(`Promoting ${id} to production`, `forge deploy promote ${id}${flag}`);
      onStarted(res.operation?.name);
    },
  );
  return (
    <Dialog title={`Promote ${id} to production?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>Production will run the build that staging runs now.</p>
        {check.isPending ? (
          <Loading what="what staging runs now" />
        ) : check.error ? (
          <ErrorNote error={check.error} />
        ) : (
          <>
            {next?.version && !released ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-[13px] font-medium">Release as</legend>
                <div className="grid grid-cols-3 gap-2">
                  {BUMPS.map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ember ${
                        bump === value ? "border-ember bg-ember-soft" : "border-line-strong bg-surface"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-[13.5px] font-medium">
                        <input
                          type="radio"
                          name="bump"
                          className="size-3.5 accent-ember"
                          checked={bump === value}
                          onChange={() => setBump(value)}
                        />
                        {label}
                      </span>
                      <span className="text-[12px] text-fg-3">{hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <FactList
              items={[
                ...(next?.version
                  ? ([
                      [
                        "Version",
                        released ? (
                          <>
                            {code(next.version)} <span className="text-fg-3">(released before; it keeps its version)</span>
                          </>
                        ) : (
                          <span aria-live="polite">
                            {staging?.version ? <>{code(staging.version)} becomes </> : null}
                            {code(next.version)}
                          </span>
                        ),
                      ],
                    ] as [string, ReactNode][])
                  : []),
                ["Commit", code(next?.commit ? shortCommit(next.commit) : "–")],
                ["Image", code(next?.image || "–")],
                ["Staging", `${deploymentStatus(staging).word}, deployed ${when(staging?.deployTime)}`],
              ]}
            />
            {moved ? (
              <p role="status" className="rounded-md bg-warn-bg px-3 py-2 text-[13.5px] text-warn-fg">
                Staging has moved on since this page loaded: it now runs {shortCommit(next.commit)}, not{" "}
                {shortCommit(staging.commit)}.
              </p>
            ) : null}
          </>
        )}
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={action.busy || !next || check.isPlaceholderData}>
            {next?.version && !check.isPlaceholderData ? `Promote as ${next.version}` : "Promote to production"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function RollbackDialog({ id, env, onClose, onStarted }: Common & { env: "staging" | "production" }) {
  const api = useApi();
  const name = `deployments/${id}/${env}`;
  const history = useQuery({
    queryKey: ["history", id, env],
    queryFn: () => api.deploys.listDeployHistory({ name, limit: 10 }).then((r) => r.records),
    staleTime: 0,
  });
  const [to, setTo] = useState("");
  // The newest record is what runs now; anything older can be restored.
  const earlier = (history.data ?? []).slice(1);
  const toast = useToast();
  const action = useAction(
    // "The one before the current" is named here, so what was shown is what is restored.
    () => api.deploys.rollbackDeploy({ name, to: to || earlier[0]?.deployCommit || "" }),
    (res) => {
      toast(`Rolling back ${id} in ${env}`, `forge deploy rollback ${id} --env ${env}${to ? ` --to ${to}` : ""}`);
      onStarted(res.operation?.name);
    },
  );
  return (
    <Dialog title={`Roll back ${id} in ${env}?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>
          {env === "production" ? "Production" : "Staging"} will run an earlier build again. Nothing is deleted: you can
          deploy or promote forward afterwards.
        </p>
        {history.isPending ? (
          <Loading what="earlier deploys" />
        ) : history.error ? (
          <ErrorNote error={history.error} />
        ) : earlier.length === 0 ? (
          <p className="text-fg-2">There is no earlier deploy to go back to.</p>
        ) : (
          <Field id="rollback-to" label="Go back to">
            <select id="rollback-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">The one before the current ({built(earlier[0])})</option>
              {earlier.map((r) => (
                <option key={r.deployCommit} value={r.deployCommit}>
                  {built(r)}, {r.kind} {when(r.time)} by {r.actor || "unknown"}
                </option>
              ))}
            </select>
          </Field>
        )}
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="danger" type="submit" disabled={action.busy || earlier.length === 0}>
            Roll back {env}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const PREVIEW_NAME = /^[a-z]([a-z0-9-]{0,38}[a-z0-9])?$/;

// PreviewDialog creates a preview of the service `id`, or of one picked from
// `services` when it is opened outside a service's page.
export function PreviewDialog({ id, services = [], onClose, onStarted }: Omit<Common, "id"> & { id?: string; services?: string[] }) {
  const api = useApi();
  const [service, setService] = useState(id ?? "");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("main");
  const [life, setLife] = useState(24);
  const [checked, setChecked] = useState(false);
  const [requestId] = useState(randomString);
  const toast = useToast();
  const bad = checked && !PREVIEW_NAME.test(name);
  const noService = checked && !service;
  const action = useAction(
    () =>
      api.environments.createEnvironment({
        environmentId: name,
        service: `services/${service}`,
        ref: ref.trim(),
        ttl: hours(life),
        requestId,
      }),
    (res) => {
      toast(`Creating the preview ${name}`, `forge env create ${name} --service ${service} --ref ${ref.trim()} --ttl ${life}h`);
      onStarted(res.operation?.name);
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (PREVIEW_NAME.test(name) && service) action.run();
  }
  return (
    <Dialog title={id ? `Create a preview of ${id}?` : "Create a preview?"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p>A preview runs one branch at its own address and is removed when its time is up.</p>
        {id ? null : (
          <Field id="preview-service" label="Service" error={noService ? "Choose the service to preview." : undefined}>
            <select
              id="preview-service"
              className={inputClass}
              value={service}
              onChange={(e) => setService(e.target.value)}
              aria-invalid={noService}
              aria-describedby="preview-service-note"
            >
              <option value="" disabled>
                Choose a service
              </option>
              {services.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          id="preview-name"
          label="Preview name"
          hint="Lowercase letters, digits and hyphens. It becomes part of the address."
          error={bad ? "Use lowercase letters, digits and hyphens, starting with a letter, at most 40." : undefined}
        >
          <input
            id="preview-name"
            className={`${inputClass} type-code`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setChecked(true)}
            aria-invalid={bad}
            aria-describedby="preview-name-note"
            placeholder="pr-42"
          />
        </Field>
        <Field id="preview-ref" label="Branch, tag or commit">
          <input id="preview-ref" className={`${inputClass} type-code`} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field id="preview-life" label="Keep it for">
          <select id="preview-life" className={inputClass} value={life} onChange={(e) => setLife(Number(e.target.value))}>
            {LIFETIMES.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={action.busy}>
            Create preview
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type OnPreview = Omit<Common, "id"> & { environment: Environment };

export function ExtendDialog({ environment, onClose, onStarted }: OnPreview) {
  const api = useApi();
  const [life, setLife] = useState(24);
  const toast = useToast();
  const id = environmentId(environment.name);
  const action = useAction(
    () => api.environments.extendEnvironment({ name: environment.name, ttl: hours(life) }),
    () => {
      toast(`${id} is kept for ${LIFETIMES.find(([h]) => h === life)?.[1] ?? `${life} hours`} from now`, `forge env extend ${id} --ttl ${life}h`);
      onStarted(undefined);
    },
  );
  return (
    <Dialog title={`Extend ${id}?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>The preview is kept for this long from now.</p>
        <Field id="extend-life" label="Keep it for">
          <select id="extend-life" className={inputClass} value={life} onChange={(e) => setLife(Number(e.target.value))}>
            {LIFETIMES.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={action.busy}>
            Extend preview
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function DestroyDialog({ environment, onClose, onStarted }: OnPreview) {
  const api = useApi();
  const toast = useToast();
  const id = environmentId(environment.name);
  const action = useAction(
    () => api.environments.destroyEnvironment({ name: environment.name }),
    (res) => {
      toast(`Destroying the preview ${id}`, `forge env destroy ${id} --yes`);
      onStarted(res.operation?.name);
    },
  );
  return (
    <Dialog title={`Destroy the preview ${id}?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>The preview and everything running in it are removed. Its branch and its image stay.</p>
        <FactList
          items={[
            ["Branch", code(environment.ref || "–")],
            ["Address", environment.url ? environment.url.replace(/^https?:\/\//, "") : "–"],
          ]}
        />
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="danger" type="submit" disabled={action.busy}>
            Destroy preview
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// DeleteServiceDialog removes a service and everything it runs. As on the
// CLI, the name is typed to confirm. previews and deployed say what there is
// to take down, as the page knows it; the API looks again when asked.
export function DeleteServiceDialog({
  id,
  previews,
  deployed,
  onClose,
  onStarted,
}: Common & { previews: string[]; deployed: string[] }) {
  const api = useApi();
  const [typed, setTyped] = useState("");
  const toast = useToast();
  const action = useAction(
    () => api.catalog.deleteService({ name: `services/${id}` }),
    (res) => {
      toast(res.operation ? `Deleting ${id}` : `${id} was removed from the catalog`, `forge service delete ${id} --yes`);
      onStarted(res.operation?.name);
    },
  );
  const matches = typed.trim() === id;
  const runs = [
    ...deployed.map((env) => `its ${env} deployment and the namespace ${id}-${env}`),
    ...(previews.length ? [`${previews.length === 1 ? "its preview" : `its ${previews.length} previews`} (${previews.join(", ")})`] : []),
  ];
  return (
    <Dialog title={`Delete ${id}?`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) action.run();
        }}
        className="flex flex-col gap-4"
      >
        {runs.length > 0 ? (
          <>
            <p>This takes down everything {id} runs, then removes it from the catalog:</p>
            <ul className="list-disc pl-5 text-[13.5px]">
              {runs.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{id} runs nothing on the cluster. This removes it from the catalog.</p>
        )}
        <p className="text-fg-2">
          Its GitHub repo is kept. If the delete fails half way, {id} stays in the catalog and you can delete it again.
        </p>
        <Field id="delete-name" label={`Type ${id} to confirm`}>
          <input
            id="delete-name"
            className={`${inputClass} font-mono`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="danger" type="submit" disabled={action.busy || !matches}>
            Delete service
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type HostKind = "own" | "root" | "other";

// ChangeAddressDialog moves where a service is reached. It is meant for the
// rare case (a service that takes over a domain of its own), so it asks
// a lot: the API plans the move first, every address in use elsewhere is
// typed to claim it, and the service's name is typed to confirm.
export function ChangeAddressDialog({
  service,
  onClose,
  onChanged,
}: {
  service: Service;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const id = service.name.replace(/^services\//, "");
  const now = service.address;
  const [clear, setClear] = useState(false);
  const [kind, setKind] = useState<HostKind>(now?.host === "@" ? "root" : now?.host && now.host !== id ? "other" : "own");
  const [other, setOther] = useState(now?.host && now.host !== "@" && now.host !== id ? now.host : "");
  const [domain, setDomain] = useState(now?.domain ?? "");
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const host = kind === "root" ? "@" : kind === "other" ? other.trim() : "";
  const request = clear ? { clear: true } : { host, domain: domain.trim() };
  // The plan is asked for once the reader has said what they want, and again
  // whenever that changes; nothing is stored by it.
  const [asked, setAsked] = useState<string | null>(null);
  const key = JSON.stringify(request);
  const plan = useQuery({
    queryKey: ["address-plan", id, asked],
    queryFn: () => api.deploys.setAddress({ service: service.name, ...request, validateOnly: true }),
    enabled: asked === key,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const planned = asked === key ? plan.data?.addresses : undefined;
  const inUse = (planned ?? []).filter((p) => p.inUse).map((p) => p.host);
  const claimed = inUse.every((h) => claims[h]?.trim() === h);
  const matches = typed.trim() === id;
  const action = useAction(
    () => api.deploys.setAddress({ service: service.name, ...request, claim: inUse, etag: service.etag }),
    () => {
      const flags = clear
        ? "--clear"
        : `--host ${host || id} --domain ${domain.trim() || "<default>"}${inUse.map((h) => ` --claim ${h}`).join("")}`;
      toast(`${id}'s address is changed; each environment moves at its next deploy`, `forge service address ${id} ${flags} --yes`);
      onChanged();
    },
  );
  const radio = (value: HostKind, label: ReactNode) => (
    <label className="flex items-center gap-2 text-[13.5px]">
      <input type="radio" name="address-host" className="size-3.5 accent-ember" checked={kind === value} onChange={() => setKind(value)} />
      {label}
    </label>
  );
  return (
    <Dialog title={`Change the address of ${id}?`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (planned && claimed && matches) action.run();
          else setAsked(key);
        }}
        className="flex flex-col gap-4"
      >
        <p>
          This moves where people reach {id}. The address it has now stops working, and links and bookmarks to it break.
          Most services never need this: their address comes from <span className="type-code">run.host</span> and{" "}
          <span className="type-code">run.domain</span> in forge.yaml.
        </p>
        <FactList
          items={[
            [
              "Now",
              now ? (
                <>
                  Set in Forge: host {code(now.host || id)}, domain {code(now.domain || "the default")}
                </>
              ) : (
                "From forge.yaml"
              ),
            ],
          ]}
        />
        {now ? (
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" className="size-3.5 accent-ember" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            Go back to forge.yaml&apos;s address
          </label>
        ) : null}
        {clear ? null : (
          <>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[13px] font-medium">Name before the domain</legend>
              {radio("own", <>Its own name ({code(id)})</>)}
              {radio("root", "The domain itself (production at the domain, staging at staging.<domain>)")}
              {radio("other", "Another name")}
              {kind === "other" ? (
                <input
                  aria-label="Another name"
                  className={`${inputClass} type-code`}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              ) : null}
            </fieldset>
            <Field id="address-domain" label="Domain" hint="One of the platform's public domains. Empty is the default one.">
              <input
                id="address-domain"
                className={`${inputClass} type-code`}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="example.com"
              />
            </Field>
          </>
        )}
        {asked === key && plan.isFetching ? <Loading what="where it would go" /> : null}
        {asked === key && plan.error ? <ErrorNote error={plan.error} /> : null}
        {planned ? (
          <>
            <FactList
              items={planned.map((p) => [
                p.env,
                <>
                  {code(p.url)}
                  {p.currentUrl && p.currentUrl !== p.url ? <span className="text-fg-3"> (now {p.currentUrl}, which stops working)</span> : null}
                </>,
              ])}
            />
            <p className="text-fg-2">Nothing moves yet: staging moves at its next deploy, production at its next promote.</p>
            {inUse.map((h) => (
              <Field
                key={h}
                id={`claim-${h}`}
                label={`${h} is in use already. Type it to take it over`}
                hint={`Whatever answers at ${h} now stops getting its visitors: they reach ${id}.`}
              >
                <input
                  id={`claim-${h}`}
                  className={`${inputClass} font-mono`}
                  value={claims[h] ?? ""}
                  onChange={(e) => setClaims((c) => ({ ...c, [h]: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            ))}
            <Field id="address-name" label={`Type ${id} to confirm`}>
              <input
                id="address-name"
                className={`${inputClass} font-mono`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        ) : null}
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          {planned ? (
            <Button kind="danger" type="submit" disabled={action.busy || !claimed || !matches}>
              Change address
            </Button>
          ) : (
            <Button type="submit" disabled={plan.isFetching || (!clear && kind === "other" && !other.trim())}>
              Show where it goes
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
