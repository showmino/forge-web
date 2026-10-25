import { type NextRequest, NextResponse } from "next/server";
import { serverApiUrl } from "@/lib/config";
import { contentSecurityPolicy, newNonce, origin } from "@/lib/csp";

// Sets the Content-Security-Policy on every page, with a nonce of its own for
// the page's scripts. The login service's address
// is not known when the image is built: forge-api names it (GetServerInfo), so
// this asks the API, remembers the answer for a while, and names both in the
// policy. Until the API has answered, the policy allows any web address.

const API = serverApiUrl();
const dev = process.env.NODE_ENV !== "production";

// How long an answer, or a failure, is remembered.
const KNOWN_MS = 5 * 60_000;
const FAILED_MS = 30_000;

let login: { origin: string | null; until: number } | null = null;

async function loginOrigin(): Promise<string | null> {
  if (login && Date.now() < login.until) return login.origin;
  let found: string | null = null;
  try {
    const res = await fetch(`${API}/forge.v1.AuthService/GetServerInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) found = origin(((await res.json()) as { oidc?: { issuer?: string } }).oidc?.issuer);
  } catch {
    found = null;
  }
  // A failure keeps the last good answer, and is tried again sooner.
  login = found ? { origin: found, until: Date.now() + KNOWN_MS } : { origin: login?.origin ?? null, until: Date.now() + FAILED_MS };
  return login.origin;
}

export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = contentSecurityPolicy({ nonce, api: origin(API), login: await loginOrigin(), dev });
  // The page is rendered with the policy in its request: the framework reads
  // the nonce from it for its own scripts, and the layout for the theme's.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

// Pages only: static files and the health check need no policy and must not wait for one.
export const config = { matcher: ["/((?!_next/|api/healthz|favicon.ico|icon.svg|robots.txt).*)"] };
