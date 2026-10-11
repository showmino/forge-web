"use client";

import { useEffect, useRef, useState } from "react";

// The Forge signature: every screen names the CLI command that does the same
// thing. The console and the CLI call the same API.

// copyText puts text on the clipboard. The clipboard API only exists on HTTPS
// pages, and a Forge on a LAN may be plain HTTP, so there is an older way too.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  before?.focus();
  return ok;
}

export function Cli({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // The command itself ("forge service list") stands out from its arguments.
  const words = command.split(" ");
  const head = words.slice(0, 3).join(" ");
  const rest = words.slice(3).join(" ");

  function copy() {
    void copyText(command).then((ok) => {
      setState(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1600);
    });
  }

  return (
    <div
      title="Same action from the terminal"
      className="inline-flex max-w-full items-center gap-2.5 self-start rounded-md border border-line bg-surface-2 py-[5px] pl-2.5 pr-1.5 font-mono text-[12.5px] text-fg-2"
    >
      <span aria-hidden="true" className="select-none text-fg-3">
        $
      </span>
      <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        <b className="font-medium text-ember-ink">{head}</b>
        {rest ? ` ${rest}` : ""}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        className="cursor-pointer rounded-sm px-1 py-0.5 font-sans text-[11.5px] text-fg-3 hover:bg-surface hover:text-fg"
      >
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select it to copy" : "Copy"}</span>
      </button>
    </div>
  );
}
