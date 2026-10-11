import type { ReactNode } from "react";
import type { Status, Tone } from "@/lib/status";

// The design system's StatusBadge and EnvTag. A status is always a glyph, a
// word and a colour together; an environment is its name with a square in its
// temper colour.

const tones: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  progress: "bg-accent-soft text-accent",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-sunken text-ink-muted",
};

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

export function StatusBadge({ status, title }: { status: Status; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-sm px-2 type-label ${tones[status.tone]}`}
    >
      <Glyph tone={status.tone} />
      {status.word}
    </span>
  );
}

const temper: Record<string, string> = {
  staging: "before:bg-temper-plum",
  production: "before:bg-temper-blue",
};

// EnvTag names an environment. kind is "staging", "production" or "preview"; a preview shows its own name.
export function EnvTag({ kind, name }: { kind: "staging" | "production" | "preview"; name?: string }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-2 whitespace-nowrap rounded-sm border border-border bg-surface px-2 font-mono text-[12px] leading-4 text-ink before:size-2 before:content-[''] ${temper[kind] ?? "before:bg-temper-straw"}`}
    >
      {name ?? kind}
    </span>
  );
}
