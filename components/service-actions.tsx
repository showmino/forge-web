"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useApi } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote, Loading } from "@/components/ui/layout";
import type { Deployment } from "@/gen/forge/v1/deploy_pb";
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

export function PromoteDialog({ id, staging, onClose, onStarted }: Common & { staging: Deployment | undefined }) {
  const api = useApi();
  const action = useAction(
    () => api.deploys.promoteDeploy({ service: `services/${id}` }),
    (res) => onStarted(res.operation?.name),
  );
  return (
    <Dialog title={`Promote ${id} to production?`} onClose={onClose}>
      <form onSubmit={action.run} className="flex flex-col gap-4">
        <p>Production will run the build that staging runs now.</p>
        <FactList
          items={[
            ["Commit", code(staging?.commit ? shortCommit(staging.commit) : "–")],
            ["Image", code(staging?.image || "–")],
            ["Staging", `${deploymentStatus(staging).word}, deployed ${when(staging?.deployTime)}`],
          ]}
        />
        {action.error ? <ErrorNote error={action.error} /> : null}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={action.busy}>
            Promote to production
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
  const action = useAction(
    () => api.deploys.rollbackDeploy({ name, to }),
    (res) => onStarted(res.operation?.name),
  );
  // The newest record is what runs now; anything older can be restored.
  const earlier = (history.data ?? []).slice(1);
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
              <option value="">The one before the current ({shortCommit(earlier[0].commit)})</option>
              {earlier.map((r) => (
                <option key={r.deployCommit} value={r.deployCommit}>
                  {shortCommit(r.commit)}, {r.kind} {when(r.time)} by {r.actor || "unknown"}
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
