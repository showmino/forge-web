import type { ReactNode } from "react";
import { type Pipeline, segment, STAGES } from "@/lib/overview";

const bar = {
  done: "bg-fg-2",
  active: "heating",
  fail: "bg-bad-dot",
  "": "bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]",
};
const label = {
  done: "text-fg-2",
  active: "font-medium text-ember-ink",
  fail: "font-medium text-bad-fg",
  "": "text-fg-3",
};

function words(p: Pipeline): string {
  const at = STAGES[p.stage];
  if (p.state === "succeeded") return "every stage done";
  if (p.state === "running") return `running at ${at}`;
  return `${p.state} at ${at}`;
}

// StageLine is the forge line: the stages of a deploy, with the one the work
// is at glowing, or red where it stopped.
export function StageLine({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div role="img" aria-label={`Deploy pipeline: ${words(pipeline)}`} className="grid grid-cols-5 gap-1">
      {STAGES.map((stage, i) => {
        const state = segment(pipeline, i);
        return (
          <div key={stage} className="flex min-w-0 flex-col gap-1.5">
            <div className={`h-2 rounded-[2px] ${bar[state]}`} />
            <div className={`truncate text-[11px] min-[561px]:text-[12px] ${label[state]}`}>
              {stage}
              {/* On a phone the stage name alone fits; the colour says the rest. */}
              {state === "active" || state === "fail" ? (
                <span className="hidden min-[561px]:inline">{state === "active" ? " · running" : " · failed"}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const mini = {
  done: "bg-fg-2",
  active: "bg-ember",
  fail: "bg-bad-dot",
  "": "bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]",
};

// MiniLine is the same line without words, for a row in a list.
export function MiniLine({ pipeline }: { pipeline: Pipeline }) {
  return (
    <span role="img" aria-label={`Pipeline: ${words(pipeline)}`} className="inline-grid flex-none grid-cols-[repeat(5,14px)] gap-0.5 align-middle">
      {STAGES.map((stage, i) => (
        <i key={stage} className={`h-1.5 rounded-[1px] ${mini[segment(pipeline, i)]}`} />
      ))}
    </span>
  );
}

// Stats is one quiet row of numbers; each leads its label. of is the total a
// number is a part of: "2 of 7".
export function Stats({ items }: { items: { label: string; value: ReactNode; of?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 rounded-lg border border-line bg-surface shadow-1 rail:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex min-w-0 flex-col-reverse justify-end gap-0.5 px-6 py-4 ${i % 2 === 1 ? "border-l border-line" : ""} ${
            i >= 2 ? "border-t border-line rail:border-t-0" : ""
          } ${i === 2 ? "rail:border-l" : ""}`}
        >
          <dt className="text-[13px] text-fg-2">{item.label}</dt>
          <dd className="font-display text-[28px] font-bold leading-[1.15] tabular-nums [font-stretch:112%]">
            {item.value}
            {item.of !== undefined ? <small className="text-[15px] font-semibold text-fg-3"> of {item.of}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
