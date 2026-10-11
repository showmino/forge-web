// The Forge API's address, set when the image is built (NEXT_PUBLIC_FORGE_API_URL).
// There is one cluster and one API, so every deployment of the dashboard talks to the same one.
export const apiUrl = (process.env.NEXT_PUBLIC_FORGE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
