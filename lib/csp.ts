// The Content-Security-Policy of every page. Styles, fonts and images come
// from the app itself only, and the pages may not be framed.
//
// Scripts run only with the nonce of their request: the framework's own, the
// one line that sets the theme before the first paint, and what those load
// ('strict-dynamic'). A script that got into a page any other way, by a name
// or a message shown without care, does not run. The session of a signed-in
// reader sits in the browser's storage for a week; this is what keeps a
// stranger's script from reading it.
//
// The pages call two other places from the browser: forge-api and the login
// service. When both are known the policy names them and nothing else;
// otherwise it falls back to any web address, so a lookup that fails never
// locks a reader out.
export function contentSecurityPolicy(opts: { nonce: string; api?: string | null; login?: string | null; dev?: boolean }): string {
  const named = opts.api && opts.login ? [opts.api, opts.login] : null;
  const connect = named ? [...new Set(named)].join(" ") : "http: https:";
  return [
    "default-src 'self'",
    // 'self' is for browsers that do not know 'strict-dynamic'; the others ignore it.
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Styles may be inline: React sets style attributes, and a style cannot read the session.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${connect}${opts.dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

// origin is the scheme and host of a web address, or null for anything else.
export function origin(address: string | undefined | null): string | null {
  try {
    const url = new URL(address ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

// newNonce is a value nobody can guess, new for every request.
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}
