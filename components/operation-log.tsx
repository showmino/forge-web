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

// The operation log: the steps of one long-running operation as they happen,
// the way `forge op watch` shows them.

export type Step = { key: string; time?: Timestamp; tone: Tone; text: ReactNode };

function clock(ts: Timestamp | undefined): string {
  return ts ? timestampDate(ts).toLocaleTimeString("en-GB", { hour12: false }) : "";
}

const stepTone: Record<Tone, string> = {
  success: "text-ok-fg",
  progress: "text-ember",
  warning: "text-warn-fg",
  danger: "text-bad-fg",
  neutral: "text-fg-3",
};

// StepLog is the list itself: a time, a status glyph and a message per line.
// New lines come at the bottom and are announced politely.
export function StepLog({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-live="polite" className="flex flex-col gap-1 py-2">
      {steps.map((s) => (
        <li key={s.key} className={`grid grid-cols-[64px_12px_minmax(0,1fr)] items-center gap-3 px-4 ${stepTone[s.tone]}`}>
          <time className="font-mono text-[12.5px] text-fg-3">{clock(s.time)}</time>
          <Glyph tone={s.tone} />
          <span className={`min-w-0 break-words ${s.tone === "neutral" ? "text-fg-2" : "text-fg"}`}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

type Watch = { events: OperationEvent[]; operation?: Operation; error?: unknown; reconnecting?: boolean };

// A watch that fails this way will fail the same way again.
const FINAL = [Code.NotFound, Code.PermissionDenied, Code.Unauthenticated, Code.InvalidArgument];
// How many times in a row the live view tries again before it says it has stopped.
const TRIES = 8;

// How long to wait before watching again: half a second, then longer, at most ten.
export function backoff(failures: number): number {
  return Math.min(500 * 2 ** (failures - 1), 10_000);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// useOperation follows an operation on the watch stream until it has ended.
// A stream that drops (a network blip, a sleeping laptop, an API restart) is
// watched again: the API replays the events from the start.
export function useOperation(name: string): Watch {
  const api = useApi();
  const [state, setState] = useState<Watch>({ events: [] });

  useEffect(() => {
    const abort = new AbortController();
    async function follow() {
      let failures = 0;
      while (!abort.signal.aborted) {
        let events: OperationEvent[] = [];
        try {
          for await (const msg of api.operations.watchOperation({ name }, { signal: abort.signal })) {
            if (msg.kind.case === "event") {
              events = [...events, msg.kind.value];
              failures = 0;
              setState({ events });
            } else if (msg.kind.case === "operation") {
              const op = msg.kind.value;
              setState({ events: op.events.length ? op.events : events, operation: op });
              return;
            }
          }
          // The stream closed without the final operation: ask where it stands.
          const res = await api.operations.getOperation({ name }, { signal: abort.signal });
          if (res.operation?.done) {
            setState({ events: res.operation.events, operation: res.operation });
            return;
          }
        } catch (err) {
          if (abort.signal.aborted) return;
          if (FINAL.some((code) => isCode(err, code))) {
            setState((s) => ({ ...s, reconnecting: false, error: err }));
            return;
          }
          if (failures + 1 >= TRIES) {
            setState((s) => ({ ...s, reconnecting: false, error: err }));
            return;
          }
        }
        // Still running, or the connection dropped: wait a little and watch again.
        failures++;
        setState((s) => ({ ...s, reconnecting: true }));
        await sleep(backoff(failures), abort.signal);
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
  const { events, operation, error, reconnecting } = useOperation(name);
  const [cancelError, setCancelError] = useState<unknown>(null);
  // "asked" stays until the operation ends: a second click would do nothing new.
  const [cancel, setCancel] = useState<"idle" | "asking" | "asked">("idle");
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
  const failed = !!operation?.error;
  const cancelled = operation?.error?.code === "cancelled";
  const status = operationStatus(operation);
  const steps: Step[] = events.map((e, i) => {
    const last = i === events.length - 1;
    // The last step is where the work is, or where it stopped.
    const tone: Tone = !last ? "success" : running ? "progress" : cancelled ? "neutral" : failed ? "danger" : "success";
    return { key: `e${i}`, time: e.time, tone, text: e.message || e.step };
  });
  if (operation?.error) {
    steps.push({
      key: "end",
      time: operation.endTime,
      tone: cancelled ? "neutral" : "danger",
      text: cancelled ? "Cancelled" : operation.error.message || operation.error.code,
    });
  }

  function askCancel() {
    setCancel("asking");
    setCancelError(null);
    api.operations.cancelOperation({ name }).then(
      () => setCancel("asked"),
      (err: unknown) => {
        setCancelError(err);
        setCancel("idle");
      },
    );
  }

  return (
    <Panel className="overflow-hidden">
      <section aria-label={`Operation ${operationId(name)}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <strong className="font-medium">{operation ? operationTitle(operation) : "Operation"}</strong>{" "}
            {link ? (
              <TextLink href={`/operations/${operationId(name)}`} className="font-mono text-[12.5px]">
                {name}
              </TextLink>
            ) : (
              <span className="font-mono text-[12.5px] text-fg-3">{name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            {running && !error ? (
              <Button size="sm" onClick={askCancel} disabled={cancel !== "idle"}>
                {cancel === "idle" ? "Cancel" : "Cancelling"}
              </Button>
            ) : null}
          </div>
        </div>
        <StepLog steps={steps} />
        {steps.length === 0 && running && !error ? <p className="px-4 py-3 text-fg-2">Waiting for the first step.</p> : null}
        {reconnecting && running && !error ? (
          <p role="status" className="border-t border-line px-4 py-2 text-[12.5px] text-fg-3">
            The connection dropped. Connecting to the live view again.
          </p>
        ) : null}
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
