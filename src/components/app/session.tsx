"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
