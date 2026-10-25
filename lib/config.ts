// The Forge API's address. The server reads FORGE_API_URL when it starts
// (NEXT_PUBLIC_FORGE_API_URL, built in by older images, is the fallback), so
// one image serves any Forge; the page hands it to the browser in a meta tag.
export const API_META = "forge-api-url";

export function serverApiUrl(): string {
  return (process.env.FORGE_API_URL || process.env.NEXT_PUBLIC_FORGE_API_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function apiUrl(): string {
  if (typeof document !== "undefined") {
    const fromPage = document.querySelector<HTMLMetaElement>(`meta[name="${API_META}"]`)?.content;
    if (fromPage) return fromPage.replace(/\/$/, "");
  }
  return serverApiUrl();
}
