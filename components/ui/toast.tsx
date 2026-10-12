"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// A toast says that an action was taken, and names the command that does the
// same from the terminal. It goes away by itself; nothing in it needs a click.

type Toast = { id: number; message: string; command?: string };
type Show = (message: string, command?: string) => void;

const ToastContext = createContext<Show>(() => {});

export function useToast(): Show {
  return useContext(ToastContext);
}

const SHOWN_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const next = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback<Show>((message, command) => {
    clearTimeout(timer.current);
    setToast({ id: ++next.current, message, command });
    timer.current = setTimeout(() => setToast(null), SHOWN_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-[60] max-w-[calc(100%-32px)]">
        {toast ? (
          <div key={toast.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-fg px-3.5 py-2.5 text-[13.5px] text-bg shadow-3">
            <span>{toast.message}</span>
            {toast.command ? <code className="font-mono text-[12.5px] opacity-85">{toast.command}</code> : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
