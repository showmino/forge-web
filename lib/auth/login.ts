import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { apiUrl } from "@/lib/config";
import { challenge, randomString } from "./pkce";
import { saveForgeSession, saveSession } from "./session";

// Login is the authorization code flow with PKCE against Forge's identity
// provider, as the public client the API names in GetServerInfo. The API
// address is all the dashboard is built with.

const PENDING = "forge.login";
const CALLBACK = "/auth/callback";

type Pending = {
  state: string;
  verifier: string;
  returnTo: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
};

type Fetch = typeof fetch;

// safeReturn keeps a return address inside the dashboard: a path, never another site.
export function safeReturn(path: string | null | undefined): string {
  if (!path || !path.startsWith("/")) return "/";
  // Resolve it as a browser would: a tab or a backslash after the first
  // slash ("/\t/evil.example.com") turns into another site there.
  const here = "http://forge.invalid";
  let url: URL;
  try {
    url = new URL(path, here);
  } catch {
    return "/";
  }
  const clean = url.pathname + url.search + url.hash;
  if (url.origin !== here || !clean.startsWith("/") || clean.startsWith("//")) return "/";
  if (url.pathname.startsWith(CALLBACK) || url.pathname.startsWith("/login")) return "/";
  return clean;
}

async function discover(fetcher: Fetch) {
  const auth = createClient(AuthService, createConnectTransport({ baseUrl: apiUrl, fetch: fetcher }));
  const info = await auth.getServerInfo({});
  const oidc = info.oidc;
  if (!oidc?.issuer || !oidc.webClientId) {
    throw new Error("This Forge does not accept dashboard logins yet. Ask platform-engineering to switch them on.");
  }
  const res = await fetcher(oidc.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration");
  if (!res.ok) throw new Error("The login service cannot be reached. Try again in a moment.");
  const doc = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("The login service gave an incomplete answer. Try again in a moment.");
  }
  // No refresh token: when the hour is up the reader logs in again. The API
  // lists the dashboard's scopes without offline_access; the filter guards
  // against an API that does not.
  const scopes = (oidc.webScopes.length ? oidc.webScopes : oidc.scopes).filter((s) => s !== "offline_access");
  return { clientId: oidc.webClientId, scopes, authorize: doc.authorization_endpoint, token: doc.token_endpoint };
}

// loginUrl prepares a login and returns the address to send the browser to.
export async function loginUrl(returnTo: string, origin: string, fetcher: Fetch = fetch): Promise<string> {
  const d = await discover(fetcher);
  const pending: Pending = {
    state: randomString(),
    verifier: randomString(),
    returnTo: safeReturn(returnTo),
    tokenEndpoint: d.token,
    clientId: d.clientId,
    redirectUri: origin + CALLBACK,
  };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  const url = new URL(d.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", d.clientId);
  url.searchParams.set("redirect_uri", pending.redirectUri);
  url.searchParams.set("scope", d.scopes.join(" "));
  url.searchParams.set("state", pending.state);
  url.searchParams.set("code_challenge", challenge(pending.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// startLogin sends the browser to the login service; it comes back to /auth/callback.
export async function startLogin(returnTo: string): Promise<void> {
  window.location.assign(await loginUrl(returnTo, window.location.origin));
}

// A Forge session as CreateSession returns it.
export type Started = { token: string; expiresAt: number };

// startSession trades a fresh ID token for a Forge session. It returns null
// when the API keeps no sessions, and throws when the API refuses.
export type StartSession = (idToken: string) => Promise<Started | null>;

// browserLabel names this browser for the list of sessions: "Firefox on Linux".
export function browserLabel(ua = navigator.userAgent): string {
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const system = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

// finishLogin completes a login from the callback's query and returns where
// the reader was going. With startSession the login ends in a Forge session.
// It throws with a message for the reader when the login cannot be completed.
export async function finishLogin(query: URLSearchParams, fetcher: Fetch = fetch, startSession?: StartSession): Promise<string> {
  const raw = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  const pending = raw ? (JSON.parse(raw) as Pending) : null;
  const ours = !!pending?.state && query.get("state") === pending.state;
  if (query.get("error")) {
    // The login service's own words, but only for a login this tab started:
    // anyone can craft a callback link with text of their choosing.
    throw new Error((ours && query.get("error_description")) || "The login was not completed.");
  }
  const code = query.get("code");
  if (!pending || !code) throw new Error("This login link is not valid any more. Sign in again.");
  if (!ours) throw new Error("This login did not start in this tab. Sign in again.");
  const res = await fetcher(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) throw new Error("The login service refused the login. Sign in again.");
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token || !saveSession(body.id_token)) {
    throw new Error("The login service gave no usable token. Sign in again.");
  }
  if (startSession) {
    // A session lasts without the login service. When it cannot be made the
    // login still works, for this tab and for as long as the ID token does.
    const started = await startSession(body.id_token).catch(() => null);
    if (started) saveForgeSession(started.token, started.expiresAt, body.id_token);
  }
  return safeReturn(pending.returnTo);
}
