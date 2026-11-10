"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useRole } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { Button, Icon } from "@/components/ui/button";
import { Cli } from "@/components/ui/cli";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { Empty, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { Tag } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import type { Token } from "@/gen/forge/v1/auth_pb";
import { when } from "@/lib/format";

const EXPIRIES: [days: number, word: string][] = [
  [7, "In 7 days"],
  [30, "In 30 days"],
  [90, "In 90 days"],
  [0, "Never"],
];

// Your settings: who you are in Forge, and the personal tokens your scripts
// and CI use. A token is shown once, when it is made.
export default function Me() {
  const api = useApi();
  const role = useRole();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.auth.getStatus({}), staleTime: 5 * 60_000 });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api.auth.listTokens({}).then((r) => r.tokens), retry: false });
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ token: Token; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);

  return (
    <>
      <PageHeader title="Your settings" lead="Who you are in Forge, and the tokens your scripts and CI use to act as you." cli="forge auth status" />

      <Section title="Profile">
        <Panel className="p-4">
          {status.isPending ? (
            <Loading what="your profile" />
          ) : status.error ? (
            <ErrorNote error={status.error} />
          ) : (
            <Facts
              items={[
                ["Email", status.data.email || "–"],
                ["Role", role],
                ["Teams", status.data.teams.length ? status.data.teams.join(", ") : "None"],
              ]}
            />
          )}
        </Panel>
      </Section>

      <Section
        title="Personal tokens"
        note={tokens.data ? tokens.data.length : undefined}
        action={
          <Button size="sm" onClick={() => setMaking(true)}>
            <Icon name="plus" />
            New token
          </Button>
        }
      >
        {tokens.isPending ? (
          <Loading what="your tokens" />
        ) : tokens.error ? (
          <ErrorNote error={tokens.error} />
        ) : tokens.data.length === 0 ? (
          <Empty>No tokens. You sign in with your browser; a token is for CI and scripts, as FORGE_TOKEN.</Empty>
        ) : (
          <TableFrame label="Personal tokens">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Can</th>
                <th className={th}>Created</th>
                <th className={th}>Last used</th>
                <th className={th}>Expires</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((t) => (
                <tr key={t.name} className={tr}>
                  <td className={`${td} font-mono font-medium`}>{t.displayName}</td>
                  <td className={td}>
                    <span className="inline-flex gap-1">
                      {t.scopes.map((s) => (
                        <Tag key={s}>{s}</Tag>
                      ))}
                    </span>
                  </td>
                  <td className={`${td} text-fg-3`}>{when(t.createTime)}</td>
                  <td className={`${td} text-fg-3`}>{when(t.lastUseTime)}</td>
                  <td className={td}>{t.expireTime ? when(t.expireTime) : <span className="font-medium text-warn-fg">Never</span>}</td>
                  <td className={`${td} text-right`}>
                    <Button kind="quiet" size="sm" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.displayName}`}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
        <p className="text-[12.5px] text-fg-3">A token acts as you, with your role, within what it can do. Give each one only what it needs, and an expiry.</p>
      </Section>

      {making ? (
        <NewTokenDialog
          onClose={() => setMaking(false)}
          onMade={(m) => {
            setMaking(false);
            setMade(m);
          }}
        />
      ) : null}
      {made ? <TokenMadeDialog made={made} onClose={() => setMade(null)} /> : null}
      {revoking ? <RevokeDialog token={revoking} onClose={() => setRevoking(null)} /> : null}
    </>
  );
}

function NewTokenDialog({ onClose, onMade }: { onClose: () => void; onMade: (m: { token: Token; secret: string }) => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const [name, setName] = useState("");
  const [deploy, setDeploy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = name !== "" && !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name);
  const scopes = [...(deploy ? ["deploy"] : []), ...(settings ? ["settings"] : [])];
  const command = `forge token create ${name || "<name>"}${scopes.map((s) => ` --scope ${s}`).join("")} --expires ${days ? `${days}d` : "never"}`;

  function make(e: FormEvent) {
    e.preventDefault();
    if (!name || bad) return;
    setBusy(true);
    setError(null);
    api.auth.createToken({ displayName: name, scopes, expireDays: days }).then(
      (r) => {
        void queries.invalidateQueries({ queryKey: ["tokens"] });
        if (r.token) onMade({ token: r.token, secret: r.secret });
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  return (
    <Dialog title="New personal token" onClose={onClose}>
      <form onSubmit={make} className="flex flex-col gap-4">
        <Field id="token-name" label="Name" hint="Where it will be used, so you know what breaks if you revoke it." error={bad ? "Lowercase letters, digits, '.', '_' and '-'." : undefined}>
          <input id="token-name" className={`${inputClass} font-mono`} value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-deploys" aria-describedby="token-name-note" autoComplete="off" />
        </Field>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold">It can</legend>
          <label className="flex items-center gap-2 text-fg-3">
            <input type="checkbox" checked disabled /> Read services, deploys and logs
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} /> Deploy, promote, roll back and manage previews
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings} onChange={(e) => setSettings(e.target.checked)} /> Change settings, resources and everything else you may
          </label>
        </fieldset>
        <Field id="token-expires" label="Expires">
          <select id="token-expires" className={inputClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRIES.map(([d, word]) => (
              <option key={d} value={d}>
                {word}
              </option>
            ))}
          </select>
        </Field>
        <Cli command={command} />
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={busy || !name || bad}>
            Make token
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// TokenMadeDialog shows the token once: Forge keeps only its hash.
function TokenMadeDialog({ made, onClose }: { made: { token: Token; secret: string }; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog title="Copy your token now" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p>
          This is the only time Forge shows <span className="font-mono">{made.token.displayName}</span>. Store it in your CI&apos;s secrets.
        </p>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 p-2.5">
          <code aria-label="The token" className="min-w-0 flex-1 font-mono text-[12.5px] break-all">
            {made.secret}
          </code>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(made.secret).then(() => toast("Token copied"));
            }}
          >
            Copy
          </Button>
        </div>
        <Cli command="export FORGE_TOKEN=… && forge auth status" />
        <DialogActions>
          <Button kind="primary" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

function RevokeDialog({ token, onClose }: { token: Token; onClose: () => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog title={`Revoke ${token.displayName}?`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p>Every script and CI job that uses it stops working at once. This cannot be undone.</p>
        <Cli command={`forge token revoke ${token.displayName}`} />
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            kind="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              api.auth.deleteToken({ name: token.name }).then(
                () => {
                  void queries.invalidateQueries({ queryKey: ["tokens"] });
                  toast(`${token.displayName} revoked`, `forge token revoke ${token.displayName}`);
                  onClose();
                },
                (err: unknown) => {
                  setError(err);
                  setBusy(false);
                },
              );
            }}
          >
            Revoke token
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
