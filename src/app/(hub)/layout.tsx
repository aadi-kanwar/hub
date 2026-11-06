"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppFrame } from "@/components/app/app-frame";
import { Brand } from "@/components/app/brand";
import { destinationFor, SignOutButton, useMe } from "@/components/app/session";
import { HUB_NAV } from "@/components/nav/nav-items";
import { BottomNav, HubSidebar } from "@/components/nav/hub-nav";
import { LoadingState } from "@/components/ui/skeleton";

/**
 * Frame and gate for every hub screen. Nothing is shown until the backend
 * confirms an active master admin who has chosen their own password; the
 * web server (src/proxy.ts) and every backend function check too.
 */
export default function HubLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null || me?.mustChangePassword) router.replace(destinationFor(me));
  }, [me, router]);

  if (me === undefined || me === null || me.mustChangePassword) {
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
                {me.name} (Master admin)
              </span>
            </div>
            {/* On phones, Log out is in the bottom bar's More menu. */}
            <span className="hidden md:block">
              <SignOutButton />
            </span>
          </div>
        </header>
      }
      sidebar={<HubSidebar items={HUB_NAV} />}
      nav={
        <BottomNav
          items={HUB_NAV.filter((item) => item.mobile !== false)}
          more={{
            items: HUB_NAV.filter((item) => item.mobile === false),
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
