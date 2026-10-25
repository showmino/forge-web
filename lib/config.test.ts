import { afterEach, describe, expect, it, vi } from "vitest";
import { API_META, apiUrl, serverApiUrl } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  document.head.innerHTML = "";
});

describe("serverApiUrl", () => {
  it("reads FORGE_API_URL when the server starts, without a trailing slash", () => {
    vi.stubEnv("FORGE_API_URL", "https://forge.example.com/");
    vi.stubEnv("NEXT_PUBLIC_FORGE_API_URL", "https://old.example.com");
    expect(serverApiUrl()).toBe("https://forge.example.com");
  });

  it("falls back to the address older images built in, then to local", () => {
    vi.stubEnv("FORGE_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_FORGE_API_URL", "https://old.example.com");
    expect(serverApiUrl()).toBe("https://old.example.com");
    vi.stubEnv("NEXT_PUBLIC_FORGE_API_URL", "");
    expect(serverApiUrl()).toBe("http://localhost:8080");
  });
});

describe("apiUrl", () => {
  it("uses the address the server put into the page", () => {
    vi.stubEnv("FORGE_API_URL", "http://wrong.example.com");
    const meta = document.createElement("meta");
    meta.name = API_META;
    meta.content = "https://forge.example.com/";
    document.head.append(meta);
    expect(apiUrl()).toBe("https://forge.example.com");
  });

  it("without one, the server's own setting", () => {
    vi.stubEnv("FORGE_API_URL", "https://forge.example.com");
    expect(apiUrl()).toBe("https://forge.example.com");
  });
});
