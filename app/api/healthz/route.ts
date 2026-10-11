// Liveness and readiness probe target (forge.yaml run.health). Never cached.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("ok\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
