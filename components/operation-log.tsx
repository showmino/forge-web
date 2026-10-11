"use client";

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApi } from "@/components/providers";
import { Button, TextLink } from "@/components/ui/button";
import { ErrorNote, Panel } from "@/components/ui/layout";
import { Glyph, StatusBadge } from "@/components/ui/status";
import type { Operation, OperationEvent } from "@/gen/forge/v1/operation_pb";
import { errorText, isCode, operationId } from "@/lib/api";
import { operationStatus, operationTitle, type Tone } from "@/lib/status";

// The design system's OperationLog: the steps of one long-running operation as
// they happen, the way `forge op watch` shows them.

export type Step = { key: string; time?: Timestamp; tone: Tone; text: ReactNode };

function clock(ts: Timestamp | undefined): string {
  return ts ? timestampDate(ts).toLocaleTimeString("en-GB", { hour12: false }) : "";
}

const stepTone: Record<Tone, string> = {
  success: "text-success",
  progress: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-ink-muted",
};

// StepLog is the list itself: a time, a status glyph and a message per line.
// New lines come at the bottom and are announced politely.
export function StepLog({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-live="polite" className="flex flex-col gap-1 py-2">
      {steps.map((s) => (
        <li key={s.key} className={`grid grid-cols-[64px_12px_1fr] items-center gap-3 px-4 ${stepTone[s.tone]}`}>
          <time className="type-code text-ink-muted">{clock(s.time)}</time>
          <Glyph tone={s.tone} />
          <span className={`min-w-0 break-words ${s.tone === "neutral" ? "text-ink-muted" : "text-ink"}`}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

type Watch = { events: OperationEvent[]; operation?: Operation; error?: unknown };

// useOperation follows an operation on the watch stream until it ends.
export function useOperation(name: string): Watch {
  const api = useApi();
  const [state, setState] = useState<Watch>({ events: [] });

  useEffect(() => {
    const abort = new AbortController();
    async function follow() {
      // A watcher that falls behind is cut off and may watch again from the start.
      for (let attempt = 0; attempt < 3; attempt++) {
        let events: OperationEvent[] = [];
        try {
          for await (const msg of api.operations.watchOperation({ name }, { signal: abort.signal })) {
            if (msg.kind.case === "event") {
              events = [...events, msg.kind.value];
              setState({ events });
            } else if (msg.kind.case === "operation") {
              const op = msg.kind.value;
              setState({ events: op.events.length ? op.events : events, operation: op });
              return;
            }
          }
          // The stream closed without the final operation (the API restarted): ask once.
          const res = await api.operations.getOperation({ name }, { signal: abort.signal });
          if (res.operation) setState({ events: res.operation.events, operation: res.operation });
          return;
        } catch (err) {
          if (abort.signal.aborted) return;
          if (isCode(err, Code.ResourceExhausted) && attempt < 2) continue;
          setState((s) => ({ ...s, error: err }));
          return;
        }
      }
    }
    void follow();
    return () => abort.abort();
  }, [api, name]);

  return state;
}

// OperationLog shows one operation live. onDone runs once, when it has ended.
export function OperationLog({ name, onDone, link = true }: { name: string; onDone?: (op: Operation) => void; link?: boolean }) {
  const api = useApi();
  const { events, operation, error } = useOperation(name);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const done = useRef(onDone);
  const reported = useRef(false);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (operation?.done && !reported.current) {
      reported.current = true;
      done.current?.(operation);
    }
  }, [operation]);

  const running = !operation?.done;
  const status = operationStatus(operation);
  const steps: Step[] = events.map((e, i) => ({
    key: `e${i}`,
    time: e.time,
    tone: running && i === events.length - 1 ? "progress" : "success",
    text: e.message || e.step,
  }));
  if (operation?.error) {
    const cancelled = operation.error.code === "cancelled";
    steps.push({
      key: "end",
      time: operation.endTime,
      tone: cancelled ? "neutral" : "danger",
      text: cancelled ? "Cancelled" : operation.error.message || operation.error.code,
    });
  }

  function cancel() {
    setCancelling(true);
    setCancelError(null);
    api.operations
      .cancelOperation({ name })
      .catch((err: unknown) => setCancelError(err))
      .finally(() => setCancelling(false));
  }

  return (
    <Panel className="overflow-hidden">
      <section aria-label={`Operation ${operationId(name)}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <strong className="type-body-strong">{operation ? operationTitle(operation) : "Operation"}</strong>{" "}
            {link ? (
              <TextLink href={`/operations/${operationId(name)}`} className="type-code">
                {name}
              </TextLink>
            ) : (
              <span className="type-code text-ink-muted">{name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            {running && !error ? (
              <Button onClick={cancel} disabled={cancelling}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
        <StepLog steps={steps} />
        {steps.length === 0 && running && !error ? <p className="px-4 py-3 text-ink-muted">Waiting for the first step.</p> : null}
        {error ? (
          <div className="p-4">
            <ErrorNote error={new Error(`The live view stopped: ${errorText(error)} The operation itself may still be running.`)} />
          </div>
        ) : null}
        {cancelError ? (
          <div className="p-4">
            <ErrorNote error={cancelError} />
          </div>
        ) : null}
      </section>
    </Panel>
  );
}
