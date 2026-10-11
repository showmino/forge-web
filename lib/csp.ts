// The Content-Security-Policy of every page. Scripts, styles, fonts and images
// come from the app itself only, and the pages may not be framed. The pages
// call two other places from the browser: forge-api and the login service.
// When both are known the policy names them and nothing else; otherwise it
// falls back to any web address, so a lookup that fails never locks a reader
// out.
export function contentSecurityPolicy(opts: { api?: string | null; login?: string | null; dev?: boolean }): string {
  const named = opts.api && opts.login ? [opts.api, opts.login] : null;
  const connect = named ? [...new Set(named)].join(" ") : "http: https:";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`,
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
