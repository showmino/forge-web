// The login lives in this tab only: the ID token sits in sessionStorage and is
// gone when the tab closes. The dashboard never judges the token; forge-api
// verifies it on every call. Here it is only read for its expiry and the
// name to show.

export type Session = {
  token: string;
  email: string;
  subject: string;
  // Milliseconds since the epoch.
  expiresAt: number;
  savedAt: number;
};

const KEY = "forge.session";
// Treat a token as expired a little early, so a call does not start with one that ends on the way.
const SKEW_MS = 30_000;

function decode(part: string): unknown {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// parseToken reads the claims of an ID token. It returns null for anything
// that is not a token with an expiry.
export function parseToken(token: string, now = Date.now()): Session | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = decode(parts[1]) as { exp?: unknown; email?: unknown; sub?: unknown };
    if (typeof claims.exp !== "number") return null;
    return {
      token,
      email: typeof claims.email === "string" ? claims.email : "",
      subject: typeof claims.sub === "string" ? claims.sub : "",
      expiresAt: claims.exp * 1000,
      savedAt: now,
    };
  } catch {
    return null;
  }
}

// loadSession returns the login of this tab, or null when there is none or it has expired.
export function loadSession(now = Date.now()): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (typeof s.token !== "string" || typeof s.expiresAt !== "number") return null;
    return s.expiresAt - SKEW_MS > now ? s : null;
  } catch {
    return null;
  }
}

// saveSession keeps a freshly issued token. It returns null when the token cannot be read.
export function saveSession(token: string, now = Date.now()): Session | null {
  const s = parseToken(token, now);
  if (!s) return null;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    return null;
  }
  return s;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}
