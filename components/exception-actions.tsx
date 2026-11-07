"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useApi } from "@/components/providers";
import { Button, ExternalButton } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ErrorNote } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";

// An exception lets the team of an infrastructure repo approve its own
// production runs, for a team of one. Asking for one, or for its end, opens a
// pull request in the deploy repo; the platform team merges it. The API
// decides who may ask: the service's team or an admin.

export const EXCEPTION_ACTION = "approval.exception";

// useCanAskException says whether the caller may ask for or revoke the
// exception of a service ("services/{id}"). TestPermissions does not report
// this action unless asked for it by name.
export function useCanAskException(service: string): boolean {
  const api = useApi();
  const q = useQuery({
    queryKey: ["can", service, EXCEPTION_ACTION],
    queryFn: () => api.auth.testPermissions({ service, actions: [EXCEPTION_ACTION] }),
    staleTime: 5 * 60_000,
  });
  return q.data?.allowed.includes(EXCEPTION_ACTION) ?? false;
}

// ExceptionDialog asks for an exception (revoke false) or for its revocation.
export function ExceptionDialog({ service, team, revoke = false, onClose }: { service: string; team: string; revoke?: boolean; onClose: () => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [opened, setOpened] = useState("");
  const id = service.replace(/^services\//, "");
  const command = `forge approval exception ${revoke ? "revoke" : "request"} ${id}`;
  const title = revoke ? `Revoke the exception of ${id}` : `Ask for an exception for ${id}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const call = revoke
      ? api.approvals.revokeException({ service, reason: reason.trim() })
      : api.approvals.requestException({ service, reason: reason.trim() });
    call.then(
      (r) => {
        void queries.invalidateQueries({ queryKey: ["exceptions"] });
        toast(revoke ? `Pull request opened to revoke the exception of ${id}` : `Pull request opened for an exception for ${id}`, command);
        setOpened(r.pullRequestUrl);
        setBusy(false);
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  if (opened) {
    return (
      <Dialog title="Pull request opened" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-fg-2">
            {revoke
              ? `Once the platform team merges it, someone else of team ${team} must approve the production runs of ${id} again, and its pull requests need an approving review again.`
              : `The exception holds once someone of the platform team approves and merges it. Until then, someone else of team ${team} approves the production runs of ${id}.`}
          </p>
          <ExternalButton href={opened}>Open the pull request</ExternalButton>
          <DialogActions>
            <Button kind="primary" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-fg-2">
          {revoke
            ? `Forge opens a pull request in the deploy repo that removes the exception. Once it is merged, team ${team} may no longer approve its own production runs of ${id}.`
            : `Forge refuses an approval from whoever pushed the commit or started the run. For a team of one, Forge opens a pull request in the deploy repo that lets team ${team} approve its own production runs of ${id}; the platform team decides whether to merge it.`}
        </p>
        <Field id="exception-reason" label="Reason" hint={revoke ? "For the platform team and the audit log." : "Why the team needs it, for the platform team. Required."}>
          <input
            id="exception-reason"
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={revoke ? "a second person joined the team" : "I am the only one on the team"}
            required={!revoke}
          />
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind={revoke ? "danger" : "primary"} type="submit" disabled={busy || (!revoke && !reason.trim())}>
            {busy ? "Opening the pull request" : revoke ? "Revoke exception" : "Ask for exception"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
