"use client";

import { useAction } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { destinationFor, useEndStaleLogin, useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Spinner } from "@/components/ui/spinner";
import { friendlyError } from "@/lib/errors";

/**
 * Opens a tool straight away, with no click: tools send people here when
 * their tool login has ended. If the hub login is still alive they're back
 * in the tool in a moment; otherwise they sign in first and come back here.
 */
export default function OpenToolPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const me = useMe();
  const router = useRouter();
  useEndStaleLogin(me);
  const getTicket = useAction(api.launch.ticket);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      router.replace(`/signin?next=${encodeURIComponent(`/open/${toolId}`)}`);
      return;
    }
    if (me.mustChangePassword) {
      router.replace(destinationFor(me));
      return;
    }
    if (started.current) return;
    started.current = true;
    getTicket({ toolId })
      .then(({ url }) => window.location.replace(url))
      .catch((e: unknown) => setError(friendlyError(e)));
  }, [me, toolId, router, getTicket]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-foreground-secondary">
      {error ? (
        <>
          <Banner tone="danger">{error}</Banner>
          <Link href="/tools" className="font-medium text-primary-text underline underline-offset-4">
            Go to your tools
          </Link>
        </>
      ) : (
        <Spinner label="Opening" />
      )}
    </main>
  );
}
