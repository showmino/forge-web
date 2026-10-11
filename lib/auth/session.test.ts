import { beforeEach, describe, expect, it } from "vitest";
import { idToken } from "@/test/helpers";
import { clearSession, loadSession, parseToken, saveForgeSession, saveSession } from "./session";

const NOW = 1_800_000_000_000;
const token = (exp: number) => idToken({ sub: "ana", email: "ana@example.com", exp });

describe("session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.clear();
  });

  it("reads the expiry and the name from a token", () => {
    const s = parseToken(token(NOW / 1000 + 3600), NOW);
    expect(s).toMatchObject({ email: "ana@example.com", subject: "ana", expiresAt: NOW + 3_600_000, savedAt: NOW });
  });

  it("reads names that are not ASCII", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ sub: "zoë", email: "zoë@example.com", exp: 1 }));
    const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parseToken(`h.${payload}.s`)?.email).toBe("zoë@example.com");
  });

  it.each(["", "not a token", "a.b", "a.!!!.c", `a.${btoa("{}")}.c`, `a.${btoa('{"exp":"soon"}')}.c`])(
    "refuses %j",
    (bad) => {
      expect(parseToken(bad)).toBeNull();
      expect(saveSession(bad)).toBeNull();
      expect(loadSession()).toBeNull();
    },
  );

  it("keeps a login for this tab until it expires", () => {
    expect(saveSession(token(NOW / 1000 + 3600), NOW)).not.toBeNull();
    expect(loadSession(NOW + 60_000)?.email).toBe("ana@example.com");
    // Half a minute early, so a call does not start with a token that ends on the way.
    expect(loadSession(NOW + 3_600_000 - 29_000)).toBeNull();
    expect(loadSession(NOW + 3_600_001)).toBeNull();
  });

  it("forgets the login on sign out", () => {
    saveSession(token(NOW / 1000 + 3600), NOW);
    clearSession();
    expect(loadSession(NOW)).toBeNull();
  });

  it("keeps a Forge session for the whole browser, for as long as the API said", () => {
    const week = 7 * 24 * 3_600_000;
    const s = saveForgeSession("fgs_abc", NOW + week, token(NOW / 1000 + 3600), NOW);
    expect(s).toMatchObject({ token: "fgs_abc", email: "ana@example.com", subject: "ana", expiresAt: NOW + week, forge: true });
    // Every tab reads it; the hour of the ID token it came from does not matter.
    expect(localStorage.getItem("forge.session")).toContain("fgs_abc");
    expect(sessionStorage.getItem("forge.session")).toBeNull();
    expect(loadSession(NOW + 6 * 24 * 3_600_000)?.token).toBe("fgs_abc");
    expect(loadSession(NOW + week + 1)).toBeNull();
    // It comes before a tab's own ID token.
    saveSession(token(NOW / 1000 + 3600), NOW);
    expect(loadSession(NOW)?.forge).toBe(true);
    clearSession();
    expect(loadSession(NOW)).toBeNull();
    expect(localStorage.getItem("forge.session")).toBeNull();
  });

  it("keeps no Forge session without a token or a readable login", () => {
    expect(saveForgeSession("", NOW + 1000, token(NOW / 1000 + 3600), NOW)).toBeNull();
    expect(saveForgeSession("fgs_abc", NOW + 1000, "not a token", NOW)).toBeNull();
    expect(loadSession(NOW)).toBeNull();
  });

  it("ignores what something else stored", () => {
    localStorage.setItem("forge.session", "{broken");
    expect(loadSession()).toBeNull();
    sessionStorage.setItem("forge.session", "{broken");
    expect(loadSession()).toBeNull();
    sessionStorage.setItem("forge.session", JSON.stringify({ token: 1 }));
    expect(loadSession()).toBeNull();
  });
});
