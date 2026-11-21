"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import * as React from "react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

/**
 * A side panel for details and editing: slides in from the right on wide
 * screens, and up from the bottom on phones. Same parts as Dialog, for
 * content that needs more room. Controlled: pass `open` and `onOpenChange`.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Buttons pinned to the bottom of the panel. */
  footer?: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-inverse/40" />
        <RadixDialog.Content
          className={cn(
            "fixed z-50 flex flex-col border-border bg-surface shadow-lg",
            "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-md border-t",
            "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:border-t-0 sm:border-l",
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-4">
            <div className="flex min-w-0 flex-col gap-1">
              <RadixDialog.Title className="text-lg font-semibold">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-sm text-foreground-secondary">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:bg-subtle"
            >
              <Icon icon={X} />
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
