"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote, Loading } from "@/components/ui/layout";
import { Bump, type Deployment } from "@/gen/forge/v1/deploy_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import { environmentId } from "@/lib/api";
import { randomString } from "@/lib/auth/pkce";
import { shortCommit, when } from "@/lib/format";
import { deploymentStatus } from "@/lib/status";

// The actions a writer takes on one service. Each is a dialog that names the
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
  const [ref, setRef] = useState("main");
  const [requestId] = useState(randomString);
  const action = useAction(
    () => api.deploys.startDeploy({ service: `services/${id}`, env: "staging", ref: ref.trim(), requestId }),
    (res) => onStarted(res.operation?.name),
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
  const action = useAction(
    () => api.deploys.promoteDeploy({ service: `services/${id}`, bump }),
    (res) => onStarted(res.operation?.name),
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
  const action = useAction(
    // "The one before the current" is named here, so what was shown is what is restored.
    () => api.deploys.rollbackDeploy({ name, to: to || earlier[0]?.deployCommit || "" }),
    (res) => onStarted(res.operation?.name),
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

export function PreviewDialog({ id, onClose, onStarted }: Common) {
  const api = useApi();
  const [name, setName] = useState("");
  const [ref, setRef] = useState("main");
  const [life, setLife] = useState(24);
  const [checked, setChecked] = useState(false);
  const [requestId] = useState(randomString);
  const bad = checked && !PREVIEW_NAME.test(name);
  const action = useAction(
    () =>
      api.environments.createEnvironment({
        environmentId: name,
        service: `services/${id}`,
        ref: ref.trim(),
        ttl: hours(life),
        requestId,
      }),
    (res) => onStarted(res.operation?.name),
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (PREVIEW_NAME.test(name)) action.run();
  }
  return (
    <Dialog title={`Create a preview of ${id}?`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p>A preview runs one branch at its own address and is removed when its time is up.</p>
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
  const action = useAction(
    () => api.environments.extendEnvironment({ name: environment.name, ttl: hours(life) }),
    () => onStarted(undefined),
  );
  const id = environmentId(environment.name);
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
  const action = useAction(
    () => api.environments.destroyEnvironment({ name: environment.name }),
    (res) => onStarted(res.operation?.name),
  );
  const id = environmentId(environment.name);
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
  const action = useAction(
    () => api.catalog.deleteService({ name: `services/${id}` }),
    (res) => onStarted(res.operation?.name),
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
