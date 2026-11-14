"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@/lib/convex";

export type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;

/** undefined while loading, null when signed out (or deactivated). */
export function useMe() {
  return useQuery(api.users.me, {});
}

/**
 * A login the backend no longer accepts (an admin's 8-hour limit, or 2 hours
 * unused) still looks signed in to the browser. Sign it out properly, so the
 * sign-in page shows instead of bouncing between pages.
 */
export function useEndStaleLogin(me: Me | null | undefined) {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const done = useRef(false);
  useEffect(() => {
    if (me === null && isAuthenticated && !done.current) {
      done.current = true;
      void signOut();
    }
  }, [me, isAuthenticated, signOut]);
}

/** Which screen a person belongs on. The backend enforces the same rules. */
export function destinationFor(me: Me | null): string {
  if (me === null) return "/signin";
  if (me.mustChangePassword) return "/change-password";
  return "/tools";
}

export function SignOutButton({ variant = "ghost", full = false }: { variant?: "ghost" | "secondary"; full?: boolean }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      width={full ? "full" : "auto"}
      className={full ? "justify-start" : undefined}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
          router.replace("/signin");
        } catch (error) {
          toast.error(friendlyError(error));
          setBusy(false);
        }
      }}
    >
      {busy ? null : <Icon icon={LogOut} />}
      Log out
    </Button>
  );
}
