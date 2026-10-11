"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/layout";
import { safeReturn, startLogin } from "@/lib/auth/login";
import { loadSession } from "@/lib/auth/session";

const REFUSED = "Forge did not accept the login it was just given. Ask platform-engineering to check the dashboard's setup.";

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (loadSession()) {
      router.replace(safeReturn(query.get("return")));
      return;
    }
    // The address is only known in the browser, after the page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query.get("error") === "refused") setError(new Error(REFUSED));
  }, [router]);

  function signIn() {
    setBusy(true);
    setError(null);
    const target = safeReturn(new URLSearchParams(window.location.search).get("return"));
    startLogin(target).catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err : new Error("The login could not start. Try again."));
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <p className="flex items-center gap-2 type-heading">
        <span aria-hidden="true" className="size-3 bg-ember" />
        Forge
      </p>
      <h1 className="type-display">Sign in to Forge</h1>
      <p className="text-fg-2">
        You sign in with your GitHub account. Members of the organization can read; the platform team can also create,
        deploy and promote.
      </p>
      {error ? <ErrorNote error={error} /> : null}
      <div>
        <Button kind="primary" onClick={signIn} disabled={busy}>
          {busy ? "Opening GitHub" : "Sign in with GitHub"}
        </Button>
      </div>
    </main>
  );
}
