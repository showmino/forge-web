import { describe, expect, it } from "vitest";
import { challenge, randomString } from "./pkce";

describe("pkce", () => {
  it("makes the S256 challenge of RFC 7636's example", () => {
    expect(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes random strings a verifier may be", () => {
    const a = randomString();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString()).not.toBe(a);
  });
});
