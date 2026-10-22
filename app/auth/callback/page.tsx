"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TextLink } from "@/components/ui/button";
import { ErrorNote, Loading } from "@/components/ui/layout";
import { startForgeSession } from "@/lib/api";
import { browserLabel, finishLogin } from "@/lib/auth/login";

// A code can be exchanged once, and React may run the effect twice while
// developing: keep the one exchange of this page load.
let exchange: Promise<string> | null = null;

export default function Callback() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    exchange ??= finishLogin(new URLSearchParams(window.location.search), fetch, (idToken) => startForgeSession(idToken, browserLabel()));
    exchange.then(
      (returnTo) => router.replace(returnTo),
      (err: unknown) => setError(err instanceof Error ? err : new Error("The login was not completed.")),
    );
  }, [router]);

  return (
    <main className="mx-auto flex min-h-[var(--vh)] max-w-sm flex-col justify-center gap-4 px-4 py-12">
      {error ? (
        <>
          <h1 className="type-title">The login was not completed</h1>
          <ErrorNote error={error} />
          <p>
            <TextLink href="/login">Sign in again</TextLink>
          </p>
        </>
      ) : (
        <Loading what="your login" />
      )}
    </main>
  );
}
