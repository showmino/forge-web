import type { ReactNode } from "react";
import { Lifecycle } from "@/gen/forge/v1/catalog_pb";
import { lifecycleWord, type Status, type Tone } from "@/lib/status";

// The Forge design language's status parts. Every status has two cues, a word
// and a colour dot; colour alone is never the signal. Ember is the colour of
// work in progress, and only that dot moves.

const pills: Record<Tone, string> = {
  success: "bg-ok-bg text-ok-fg before:bg-ok-dot",
  progress: "pulsing bg-ember-soft text-ember-ink before:bg-ember",
  warning: "bg-warn-bg text-warn-fg before:bg-warn-dot",
  danger: "bg-bad-bg text-bad-fg before:bg-bad-dot",
  neutral: "bg-surface-2 text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] before:bg-fg-3",
};

// StatusBadge is the status pill: a dot and a word.
export function StatusBadge({ status, title }: { status: Status; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-px pl-[7px] pr-2 type-label before:size-1.5 before:rounded-full before:content-[''] ${pills[status.tone]}`}
    >
      {status.word}
    </span>
  );
}

const glyphs: Record<Tone, ReactNode> = {
  success: <path d="M2.5 6.5 5 9l4.5-5.5" />,
  progress: (
    <>
      <circle cx="6" cy="6" r="4.2" opacity=".3" />
      <path d="M6 1.8A4.2 4.2 0 0 1 10.2 6" />
    </>
  ),
  warning: (
    <>
      <path d="M6 1.8 10.6 9.8H1.4z" />
      <path d="M6 5v2.2M6 8.4v.1" />
    </>
  ),
  danger: <path d="M3 3l6 6M9 3l-6 6" />,
  neutral: <circle cx="6" cy="6" r="1.6" fill="currentColor" stroke="none" />,
};

// Glyph marks a line of a log or a note: a tick, a ring for running work, a cross.
export function Glyph({ tone }: { tone: Tone }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`size-3 flex-none ${tone === "progress" ? "turning" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[tone]}
    </svg>
  );
}

const envSquare: Record<string, string> = {
  staging: "before:bg-env-staging",
  production: "before:bg-env-production",
};

// EnvTag names an environment in mono with a square in its colour. kind is
// "staging", "production" or "preview"; a preview shows its own name.
export function EnvTag({ kind, name }: { kind: "staging" | "production" | "preview"; name?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-sm border border-line-strong bg-surface px-2 py-px font-mono text-[12.5px] text-fg before:size-2 before:rounded-[1px] before:content-[''] ${envSquare[kind] ?? "before:bg-env-preview"}`}
    >
      {name ?? kind}
    </span>
  );
}

const lifeDot: Partial<Record<Lifecycle, string>> = {
  [Lifecycle.PRODUCTION]: "before:border-fg-2 before:bg-fg-2",
  [Lifecycle.EXPERIMENTAL]: "before:border-dashed before:border-ember",
  [Lifecycle.DEPRECATED]: "line-through decoration-fg-3 before:border-fg-3",
};

// Life says where a service is in its life: a ring, filled once it is in production.
export function Life({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-fg-2 before:size-[7px] before:rounded-full before:border-[1.5px] before:content-[''] ${lifeDot[lifecycle] ?? "before:border-fg-3"}`}
    >
      {lifecycleWord(lifecycle)}
    </span>
  );
}

// Tag is a small mono label: a commit, a template, a version.
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-sm border border-line px-1.5 font-mono text-[11.5px] text-fg-2">
      {children}
    </span>
  );
}
