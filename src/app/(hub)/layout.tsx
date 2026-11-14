"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppFrame } from "@/components/app/app-frame";
import { Brand } from "@/components/app/brand";
import { destinationFor, useEndStaleLogin, SignOutButton, useMe } from "@/components/app/session";
import { isAdminPath, navFor } from "@/components/nav/nav-items";
import { PROFILE_TYPE_LABELS } from "@convex/lib/profiles";
import { BottomNav, HubSidebar } from "@/components/nav/hub-nav";
import { LoadingState } from "@/components/ui/skeleton";

/**
 * Frame and gate for every hub screen. Nothing is shown until the backend
 * confirms an active person who has chosen their own password; admin pages
 * also need a master admin. The web server (src/proxy.ts) and every backend
 * function check too.
 */
export default function HubLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  useEndStaleLogin(me);
  const pathname = usePathname();
  const blocked = me != null && me.profileType !== "admin" && isAdminPath(pathname);
  useEffect(() => {
    if (me === null || me?.mustChangePassword) router.replace(destinationFor(me));
    else if (blocked) router.replace("/tools");
  }, [me, router, blocked]);

  if (me === undefined || me === null || me.mustChangePassword || blocked) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <LoadingState />
      </div>
    );
  }

  return (
    <AppFrame
      header={
        <header className="border-b border-border bg-surface">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <Brand />
              <span className="hidden truncate border-l border-border pl-3 text-xs text-foreground-secondary lg:block">
                {me.name} ({PROFILE_TYPE_LABELS[me.profileType]})
              </span>
            </div>
            {/* On phones, Log out is in the bottom bar's More menu. */}
            <span className="hidden md:block">
              <SignOutButton />
            </span>
          </div>
        </header>
      }
      sidebar={<HubSidebar items={navFor(me.profileType)} />}
      nav={
        <BottomNav
          items={navFor(me.profileType).filter((item) => item.mobile !== false)}
          more={{
            items: navFor(me.profileType).filter((item) => item.mobile === false),
            footer: <SignOutButton variant="ghost" full />,
          }}
        />
      }
    >
      <main className="px-4 pt-6 pb-10 md:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
      </main>
    </AppFrame>
  );
}
