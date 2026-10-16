"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { copyText } from "./cli";

// CodeBlock is a <pre> of a docs page with a button that copies what it shows,
// without the newline Markdown leaves at the end.
export function CodeBlock(props: ComponentProps<"pre">) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy() {
    const text = (pre.current?.textContent ?? "").replace(/\n$/, "");
    void copyText(text).then((ok) => {
      setState(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1600);
    });
  }

  const label = state === "copied" ? "Copied" : state === "failed" ? "Select it to copy" : "Copy code";
  return (
    <div className="doc-code relative">
      <pre ref={pre} {...props} />
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className="absolute right-2 top-2 grid size-8 cursor-pointer place-items-center rounded-md border border-rail-line bg-rail-bg text-rail-fg-2 hover:bg-rail-active hover:text-rail-fg"
      >
        {state === "copied" ? (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5.25" y="5.25" width="8" height="9" rx="1.25" />
            <path d="M3 10.75V3.25c0-.7.55-1.25 1.25-1.25H10" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
