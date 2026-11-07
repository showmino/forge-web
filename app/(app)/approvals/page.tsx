"use client";

import { Code } from "@connectrpc/connect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ExceptionDialog, useCanAskException } from "@/components/exception-actions";
import { useApi } from "@/components/providers";
import { Button, ExternalButton, NameLink } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { Empty, ErrorNote, Loading, PageHeader, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { type Approval, Approval_State, type Exception } from "@/gen/forge/v1/approval_pb";
import { approvalId, isCode } from "@/lib/api";
import { shortCommit, when } from "@/lib/format";
import { approvalStatus } from "@/lib/status";

// The production runs of infrastructure repos: they wait here for an
// approval by someone of the owning team other than who started them. The
// API decides who may approve; this page only asks.

type View = "waiting" | "all";

export default function Approvals() {
  const api = useApi();
  const [view, setView] = useState<View>("waiting");
  const [deciding, setDeciding] = useState<{ approval: Approval; approve: boolean } | null>(null);
  const approvals = useQuery({
    queryKey: ["approvals", view],
    queryFn: () =>
      api.approvals.listApprovals({ state: view === "waiting" ? Approval_State.PENDING : Approval_State.UNSPECIFIED, pageSize: 100 }).then((r) => r.approvals),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="Approvals"
        lead="Production runs of infrastructure repos wait here. Someone of the owning team approves them, but not the person who pushed the commit or started the run; Forge then starts the run, which deploys that commit."
        cli="forge approval list --state pending"
      />
      <Tabs
        label="Approvals"
        tabs={[
          { value: "waiting", label: "Waiting" },
          { value: "all", label: "All" },
        ]}
        value={view}
        onChange={setView}
      >
        {approvals.isPending ? (
          <Loading what="approvals" />
        ) : approvals.error ? (
          isCode(approvals.error, Code.FailedPrecondition) ? (
            <Empty>This Forge has no infrastructure repos, so nothing needs an approval.</Empty>
          ) : (
            <ErrorNote error={approvals.error} />
          )
        ) : approvals.data.length === 0 ? (
          <Empty>{view === "waiting" ? "Nothing waits for an approval." : "No production run has asked for an approval yet."}</Empty>
        ) : (
          <TableFrame label="Approvals">
            <thead>
              <tr>
                <th className={th}>Service</th>
                <th className={th}>Commit</th>
                <th className={th}>State</th>
                <th className={th}>Asked by</th>
                <th className={th}>Decided by</th>
                <th className={th}>Asked</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {approvals.data.map((a) => {
                const svc = a.service.replace(/^services\//, "");
                const retry = a.state === Approval_State.APPROVED && a.dispatchError !== "";
                return (
                  <tr key={a.name} className={tr}>
                    <td className={td}>
                      <NameLink href={`/services/${encodeURIComponent(svc)}`}>{svc}</NameLink>
                    </td>
                    <td className={`${td} font-mono`}>
                      {a.runUrl ? (
                        <a className="underline decoration-line-strong underline-offset-2 hover:decoration-fg" href={a.runUrl} target="_blank" rel="noreferrer">
                          {shortCommit(a.commit)}
                        </a>
                      ) : (
                        shortCommit(a.commit)
                      )}
                    </td>
                    <td className={td}>
                      <StatusBadge status={approvalStatus(a)} title={a.dispatchError || undefined} />
                    </td>
                    <td className={td}>{a.requestedBy}</td>
                    <td className={`${td} text-fg-2`}>{a.decidedBy || "—"}</td>
                    <td className={`${td} text-fg-2`}>{when(a.createTime)}</td>
                    <td className={`${td} text-right`}>
                      {a.state === Approval_State.PENDING ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" onClick={() => setDeciding({ approval: a, approve: false })}>
                            Reject
                          </Button>
                          <Button size="sm" kind="primary" onClick={() => setDeciding({ approval: a, approve: true })}>
                            Approve
                          </Button>
                        </span>
                      ) : retry ? (
                        <Button size="sm" onClick={() => setDeciding({ approval: a, approve: true })}>
                          Start the run again
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </Tabs>
      <Exceptions />
      {deciding ? <Decide {...deciding} onClose={() => setDeciding(null)} /> : null}
    </>
  );
}

// Decide approves or rejects one approval, with a reason for the audit log.
function Decide({ approval, approve, onClose }: { approval: Approval; approve: boolean; onClose: () => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = approvalId(approval.name);
  const svc = approval.service.replace(/^services\//, "");
  const verb = approve ? "approve" : "reject";

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const call = approve
      ? api.approvals.approveApproval({ name: approval.name, reason }).then((r) => r.approval)
      : api.approvals.rejectApproval({ name: approval.name, reason }).then((r) => r.approval);
    call.then(
      (a) => {
        void queries.invalidateQueries({ queryKey: ["approvals"] });
        if (a?.dispatchError) {
          setError(new Error(`Approved, but the production run could not be started: ${a.dispatchError}. Approve again to retry.`));
          setBusy(false);
          return;
        }
        toast(approve ? `Approved: the production run of ${svc} is starting` : `Rejected ${shortCommit(approval.commit)} of ${svc}`, `forge approval ${verb} ${id}`);
        onClose();
      },
      (err: unknown) => {
        setError(err);
        setBusy(false);
      },
    );
  }

  return (
    <Dialog title={approve ? `Approve production for ${svc}` : `Reject production for ${svc}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-fg-2">
          {approve
            ? `Forge starts the production run of ${svc}, which deploys ${shortCommit(approval.commit)} as ${approval.requestedBy} pushed it. Read its plan in the run first.`
            : `The run of ${shortCommit(approval.commit)} will not deploy to production.`}
        </p>
        {approval.runUrl ? <ExternalButton href={approval.runUrl}>Open the run</ExternalButton> : null}
        <Field id="decide-reason" label="Reason" hint="For the audit log.">
          <input id="decide-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={approve ? "plan reviewed" : "why not"} />
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind={approve ? "primary" : "danger"} type="submit" disabled={busy}>
            {busy ? (approve ? "Approving" : "Rejecting") : approve ? "Approve" : "Reject"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// Exceptions lets teams of one approve their own runs; the platform team
// grants them in the deploy repo. Hidden on a Forge without them.
function Exceptions() {
  const api = useApi();
  const [revoking, setRevoking] = useState<Exception | null>(null);
  const exceptions = useQuery({
    queryKey: ["exceptions"],
    queryFn: () => api.approvals.listExceptions({}).then((r) => r.exceptions),
    staleTime: 60_000,
    retry: false,
  });
  if (exceptions.isPending || (exceptions.error && isCode(exceptions.error, Code.FailedPrecondition))) return null;
  return (
    <Section title="Exceptions" note={<span className="font-mono">forge approval exception list</span>}>
      {exceptions.error ? (
        <ErrorNote error={exceptions.error} />
      ) : exceptions.data.length === 0 ? (
        <Empty>No team approves its own runs. A team of one asks for an exception on its infrastructure repo&apos;s page.</Empty>
      ) : (
        <TableFrame label="Exceptions">
          <thead>
            <tr>
              <th className={th}>Service</th>
              <th className={th}>Team</th>
              <th className={th}>Holds</th>
              <th className={th}>Granted by</th>
              <th className={th}>Reason</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exceptions.data.map((e) => {
              const svc = e.service.replace(/^services\//, "");
              return (
                <tr key={e.service} className={tr}>
                  <td className={td}>
                    <NameLink href={`/services/${encodeURIComponent(svc)}`}>{svc}</NameLink>
                  </td>
                  <td className={td}>{e.team}</td>
                  <td className={td}>
                    <StatusBadge status={e.granted ? { tone: "success", word: "Holds" } : { tone: "warning", word: "Not yet" }} title={e.problem || undefined} />
                  </td>
                  <td className={`${td} text-fg-2`}>{e.grantedBy || "—"}</td>
                  <td className={`${td} whitespace-normal text-fg-2`}>{e.granted ? e.reason : e.problem}</td>
                  <td className={`${td} text-right`}>
                    <RevokeButton service={e.service} onClick={() => setRevoking(e)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      )}
      {revoking ? <ExceptionDialog service={revoking.service} team={revoking.team} revoke onClose={() => setRevoking(null)} /> : null}
    </Section>
  );
}

// RevokeButton is shown only to who may revoke the exception: its team or an admin.
function RevokeButton({ service, onClick }: { service: string; onClick: () => void }) {
  const svc = service.replace(/^services\//, "");
  if (!useCanAskException(service)) return null;
  return (
    <Button size="sm" onClick={onClick} aria-label={`Revoke the exception of ${svc}`}>
      Revoke
    </Button>
  );
}
