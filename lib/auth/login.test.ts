import { beforeEach, describe, expect, it } from "vitest";
import { idToken } from "@/test/helpers";
import { browserLabel, finishLogin, loginUrl, safeReturn } from "./login";
import { challenge } from "./pkce";
import { loadSession } from "./session";

const ISSUER = "http://dex.example.com/dex";

// A Forge API and a login service, as far as a login needs them.
function fakeFetch(opts: { webClientId?: string; webScopes?: string[]; token?: Response } = {}) {
  const calls: { url: string; body?: string }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.endsWith("/forge.v1.AuthService/GetServerInfo")) {
      const oidc = {
        issuer: ISSUER,
        clientId: "forge-cli",
        scopes: ["openid", "email", "profile", "groups", "offline_access"],
        webClientId: opts.webClientId ?? "forge-web",
        webScopes: opts.webScopes ?? ["openid", "email", "profile", "groups"],
      };
      return new Response(JSON.stringify({ oidc }), { headers: { "Content-Type": "application/json" } });
    }
    if (url === ISSUER + "/.well-known/openid-configuration") {
      return Response.json({ authorization_endpoint: ISSUER + "/auth", token_endpoint: ISSUER + "/token" });
    }
    if (url === ISSUER + "/token") {
      return opts.token ?? Response.json({ id_token: idToken({ sub: "ana", email: "ana@example.com", exp: Date.now() / 1000 + 3600 }) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

describe("safeReturn", () => {
  it.each([
    ["/services/payments", "/services/payments"],
    ["/audit?service=payments", "/audit?service=payments"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example.com", "/"],
    ["//evil.example.com", "/"],
    ["/\\evil.example.com", "/"],
    ["/\t/evil.example.com", "/"],
    ["/\n/evil.example.com", "/"],
    ["/\r\\evil.example.com", "/"],
    ["/.//evil.example.com", "/"],
    ["/services/../audit", "/audit"],
    ["services", "/"],
    ["/login?return=/x", "/"],
    ["/auth/callback?code=1", "/"],
  ])("%j → %j", (path, want) => {
    expect(safeReturn(path)).toBe(want);
  });
});

describe("login", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.clear();
  });

  it("sends the browser to the login service with a PKCE challenge and no refresh scope", async () => {
    const { fetcher } = fakeFetch();
    const url = new URL(await loginUrl("/services/payments", "http://forge-web.example.com", fetcher));
    expect(url.origin + url.pathname).toBe(ISSUER + "/auth");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("forge-web");
    expect(q.get("redirect_uri")).toBe("http://forge-web.example.com/auth/callback");
    expect(q.get("scope")).toBe("openid email profile groups");
    expect(q.get("code_challenge_method")).toBe("S256");
    const pending = JSON.parse(sessionStorage.getItem("forge.login")!);
    expect(q.get("state")).toBe(pending.state);
    expect(q.get("code_challenge")).toBe(challenge(pending.verifier));
    expect(pending.returnTo).toBe("/services/payments");
  });

  it("never asks for a refresh token, even when the API lists the scope", async () => {
    const { fetcher } = fakeFetch({ webScopes: [] });
    const url = new URL(await loginUrl("/", "http://forge-web.example.com", fetcher));
    expect(url.searchParams.get("scope")).toBe("openid email profile groups");
  });

  it("says so when the API does not accept dashboard logins", async () => {
    const { fetcher } = fakeFetch({ webClientId: "" });
    await expect(loginUrl("/", "http://forge-web.example.com", fetcher)).rejects.toThrow(/does not accept dashboard logins/);
  });

  it("exchanges the code with the verifier and keeps the token", async () => {
    const { fetcher, calls } = fakeFetch();
    const url = new URL(await loginUrl("/audit", "http://forge-web.example.com", fetcher));
    const pending = JSON.parse(sessionStorage.getItem("forge.login")!);
    const back = new URLSearchParams({ code: "abc", state: url.searchParams.get("state")! });
    expect(await finishLogin(back, fetcher)).toBe("/audit");
    expect(loadSession()?.email).toBe("ana@example.com");
    const sent = new URLSearchParams(calls.at(-1)!.body);
    expect(Object.fromEntries(sent)).toEqual({
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "http://forge-web.example.com/auth/callback",
      client_id: "forge-web",
      code_verifier: pending.verifier,
    });
    // A code is used once: the pending login is gone.
    expect(sessionStorage.getItem("forge.login")).toBeNull();
  });

  it("refuses a callback whose state is not this tab's", async () => {
    const { fetcher, calls } = fakeFetch();
    await loginUrl("/", "http://forge-web.example.com", fetcher);
    const before = calls.length;
    await expect(finishLogin(new URLSearchParams({ code: "abc", state: "someone-else" }), fetcher)).rejects.toThrow(/did not start in this tab/);
    expect(calls.length).toBe(before);
    expect(loadSession()).toBeNull();
  });

  it("refuses a callback without a login in progress", async () => {
    const { fetcher } = fakeFetch();
    await expect(finishLogin(new URLSearchParams({ code: "abc", state: "x" }), fetcher)).rejects.toThrow(/not valid any more/);
  });

  it("reports what the login service said went wrong", async () => {
    const { fetcher } = fakeFetch();
    const url = new URL(await loginUrl("/", "http://forge-web.example.com", fetcher));
    const state = url.searchParams.get("state")!;
    const back = new URLSearchParams({ error: "access_denied", error_description: "You are not a member of the organization.", state });
    await expect(finishLogin(back, fetcher)).rejects.toThrow("You are not a member of the organization.");
    // A crafted link, with no login of this tab behind it, cannot put its own words on the page.
    await loginUrl("/", "http://forge-web.example.com", fetcher);
    const crafted = new URLSearchParams({ error: "x", error_description: "Call 555-0100 to restore access.", state: "guess" });
    await expect(finishLogin(crafted, fetcher)).rejects.toThrow("The login was not completed.");
  });

  it("ends in a Forge session when the API keeps them, made from the fresh ID token", async () => {
    const { fetcher } = fakeFetch();
    const url = new URL(await loginUrl("/audit", "http://forge-web.example.com", fetcher));
    const back = new URLSearchParams({ code: "abc", state: url.searchParams.get("state")! });
    const seen: string[] = [];
    const ends = Date.now() + 7 * 24 * 3_600_000;
    const start = async (idToken: string) => {
      seen.push(idToken);
      return { token: "fgs_session", expiresAt: ends };
    };
    expect(await finishLogin(back, fetcher, start)).toBe("/audit");
    expect(seen).toHaveLength(1);
    expect(seen[0].split(".")).toHaveLength(3);
    expect(loadSession()).toMatchObject({ token: "fgs_session", email: "ana@example.com", expiresAt: ends, forge: true });
    // The ID token is not kept beside it.
    expect(sessionStorage.getItem("forge.session")).toBeNull();
  });

  it("keeps the ID token for this tab when no session can be made", async () => {
    for (const start of [async () => null, async () => Promise.reject(new Error("the API is away"))]) {
      sessionStorage.clear();
      localStorage.clear();
      const { fetcher } = fakeFetch();
      const url = new URL(await loginUrl("/", "http://forge-web.example.com", fetcher));
      const back = new URLSearchParams({ code: "abc", state: url.searchParams.get("state")! });
      expect(await finishLogin(back, fetcher, start)).toBe("/");
      const s = loadSession();
      expect(s?.forge).toBeUndefined();
      expect(s?.email).toBe("ana@example.com");
      expect(localStorage.getItem("forge.session")).toBeNull();
    }
  });

  it("names the browser for the list of sessions", () => {
    expect(browserLabel("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
    expect(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari on macOS");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe("Edge on Windows");
    expect(browserLabel("curl/8")).toBe("Browser");
  });

  it("keeps no login when the service refuses the code or sends no token", async () => {
    for (const token of [new Response("no", { status: 400 }), Response.json({ access_token: "x" })]) {
      sessionStorage.clear();
      localStorage.clear();
      const { fetcher } = fakeFetch({ token });
      const url = new URL(await loginUrl("/", "http://forge-web.example.com", fetcher));
      const back = new URLSearchParams({ code: "abc", state: url.searchParams.get("state")! });
      await expect(finishLogin(back, fetcher)).rejects.toThrow(/Sign in again/);
      expect(loadSession()).toBeNull();
    }
  });
});
