import { sha256 } from "@noble/hashes/sha2.js";

// The pieces of the authorization code flow with PKCE (RFC 7636). The hash
// comes from a library because the browser's crypto.subtle only exists on
// HTTPS pages, and a Forge on a LAN may be plain HTTP. Random bytes come from
// crypto.getRandomValues, which works on both.

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// randomString returns 32 random bytes as 43 URL-safe characters: a state or a code verifier.
export function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

// challenge is the S256 code challenge of a verifier.
export function challenge(verifier: string): string {
  return base64url(sha256(new TextEncoder().encode(verifier)));
}
