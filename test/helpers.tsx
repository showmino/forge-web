import { createRouterTransport, type ConnectRouter } from "@connectrpc/connect";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { saveSession } from "@/lib/auth/session";

// idToken makes an unsigned token with the claims the dashboard reads. The
// dashboard never verifies a token (forge-api does), so no signature is needed.
export function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

// signIn puts a login that lasts an hour into this tab.
export function signIn(email = "ana@example.com") {
  saveSession(idToken({ sub: "ana", email, exp: Math.floor(Date.now() / 1000) + 3600 }));
}

// renderWithApi renders a page against an in-memory Forge API.
export function renderWithApi(ui: ReactNode, routes: (router: ConnectRouter) => void) {
  return render(<Providers transport={createRouterTransport(routes)}>{ui}</Providers>);
}
