"use client";

import Link from "next/link";
import { AppFrame } from "./app-frame";
import { Brand } from "./brand";
import { SignOutButton } from "./session";

/** A simple frame (name and Log out) for screens outside the main hub, like the password change. */
export function PlainShell({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame
      header={
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
            <Link href="/" aria-label="Admin Hub home">
              <Brand />
            </Link>
            <SignOutButton />
          </div>
        </header>
      }
    >
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-6">{children}</main>
    </AppFrame>
  );
}
