"use client";

import { createRouterTransport, Code, type Transport } from "@connectrpc/connect";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { mockIdToken, mockRoutes } from "@/dev/mock-api";
import { isCode, makeApi, webTransport, type Api } from "@/lib/api";
import { startLogin } from "@/lib/auth/login";
import { clearSession, loadSession, saveSession } from "@/lib/auth/session";

// npm run dev:mock calls forge-api with no cluster and no GitHub login: an
// in-memory router (dev/mock-api.ts) stands in, and a fake session is
// written before anything asks for one. NEXT_PUBLIC_* is read at build
// time, so this can never be on in a real deployment -- the build that
// makes the shipped image never sets it (docs/development.md).
const MOCK = process.env.NEXT_PUBLIC_MOCK_API === "1";

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

let leaving = false;

function loginAgain(err: unknown) {
  if (!isCode(err, Code.Unauthenticated) || typeof window === "undefined" || leaving) return;
  leaving = true;
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
  const [value] = useState(() => {
    const mock = MOCK && !transport;
    if (mock && !loadSession()) saveSession(mockIdToken());
    return {
      api: makeApi(transport ?? (mock ? createRouterTransport(mockRoutes) : webTransport())),
      queries: new QueryClient({
        queryCache: new QueryCache({ onError: loginAgain }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (failures, err) => !transport && !mock && failures < 1 && !FINAL.some((code) => isCode(err, code)),
          },
        },
      }),
    };
  });
  return (
    <ApiContext.Provider value={value.api}>
      <QueryClientProvider client={value.queries}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
