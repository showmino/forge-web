"use client";

import { Code, type Transport } from "@connectrpc/connect";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { isCode, makeApi, webTransport, type Api } from "@/lib/api";
import { startLogin } from "@/lib/auth/login";
import { clearSession, loadSession } from "@/lib/auth/session";

const ApiContext = createContext<Api | null>(null);

// useApi gives the clients of the Forge API.
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs <Providers>");
  return api;
}

// A token the API refuses right after login will be refused again: stop
// instead of sending the reader round and round.
const FRESH_MS = 60_000;

// This runs outside React, and a full page load is wanted: it drops whatever
// the ended login had loaded.
function leave(to: string) {
  window.location.assign(to);
}

function loginAgain(err: unknown) {
  if (!isCode(err, Code.Unauthenticated) || typeof window === "undefined") return;
  const session = loadSession();
  clearSession();
  if (session && Date.now() - session.savedAt < FRESH_MS) {
    leave("/login?error=refused");
    return;
  }
  const here = window.location.pathname + window.location.search;
  startLogin(here).catch(() => leave("/login"));
}

// Calls that will fail the same way again are not retried.
const FINAL = [Code.Unauthenticated, Code.PermissionDenied, Code.NotFound, Code.InvalidArgument, Code.FailedPrecondition];

// Providers gives the pages the API clients and the query cache. Tests pass
// their own transport; the app uses the browser's.
export function Providers({ children, transport }: { children: ReactNode; transport?: Transport }) {
  const [value] = useState(() => ({
    api: makeApi(transport ?? webTransport()),
    queries: new QueryClient({
      queryCache: new QueryCache({ onError: loginAgain }),
      defaultOptions: {
        queries: {
          staleTime: 15_000,
          retry: (failures, err) => !transport && failures < 1 && !FINAL.some((code) => isCode(err, code)),
        },
      },
    }),
  }));
  return (
    <ApiContext.Provider value={value.api}>
      <QueryClientProvider client={value.queries}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}
