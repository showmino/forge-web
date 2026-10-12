import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, origin } from "./csp";

const connect = (policy: string) => policy.split("; ").find((d) => d.startsWith("connect-src"));

describe("the content security policy", () => {
  it("names forge-api and the login service, and nothing else, when both are known", () => {
    const policy = contentSecurityPolicy({ nonce: "n0", api: "http://forge.example.com", login: "http://dex.example.com" });
    expect(connect(policy)).toBe("connect-src 'self' http://forge.example.com http://dex.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("runs only scripts that carry the request's nonce", () => {
    const script = (policy: string) => policy.split("; ").find((d) => d.startsWith("script-src"));
    const policy = contentSecurityPolicy({ nonce: "abc123", api: "https://forge.example.com", login: "https://login.example.com" });
    expect(script(policy)).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    // No inline script without the nonce, in production or while developing.
    expect(script(policy)).not.toContain("unsafe-inline");
    expect(script(contentSecurityPolicy({ nonce: "abc123", dev: true }))).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'");
  });

  it("makes a nonce nobody can guess, new each time", () => {
    const seen = new Set(Array.from({ length: 200 }, newNonce));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{24}$/);
  });

  it("names one address once when both live on it", () => {
    expect(connect(contentSecurityPolicy({ nonce: "n0", api: "https://forge.example.com", login: "https://forge.example.com" }))).toBe(
      "connect-src 'self' https://forge.example.com",
    );
  });

  it("stays open when the login service is not known, so nobody is locked out", () => {
    expect(connect(contentSecurityPolicy({ nonce: "n0", api: "http://forge.example.com", login: null }))).toBe("connect-src 'self' http: https:");
  });

  it("lets the development server work", () => {
    const policy = contentSecurityPolicy({ nonce: "n0", dev: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(connect(policy)).toBe("connect-src 'self' http: https: ws:");
  });
});

describe("origin", () => {
  it.each([
    ["http://dex.10.150.1.220.nip.io/dex", "http://dex.10.150.1.220.nip.io"],
    ["https://login.example.com:8443/realms/x", "https://login.example.com:8443"],
    ["javascript:alert(1)", null],
    ["not an address", null],
    ["", null],
    [undefined, null],
  ])("%j → %j", (address, want) => {
    expect(origin(address)).toBe(want);
  });
});
