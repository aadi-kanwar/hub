"use client";

import { Check, CircleDashed, X, type LucideIcon } from "lucide-react";
import { Icon } from "./icon";
import { StatusBadge } from "./status-badge";
import { YesNoToggle, type YesNo } from "./yes-no-toggle";

/** A saved choice as a badge: Yes, No or Not answered (never assumed No). */
export function ChoiceBadge({ value }: { value: YesNo | null }) {
  if (value === "yes") return <StatusBadge tone="primary" icon={Check}>Yes</StatusBadge>;
  if (value === "no") return <StatusBadge tone="neutral" icon={X}>No</StatusBadge>;
  return <StatusBadge tone="neutral" icon={CircleDashed}>Not answered</StatusBadge>;
}

/**
 * One meal in a list: icon, name and time on the left, the Yes/No choice on
 * the right. When `locked`, the saved choice is shown as a badge instead.
 * Render inside a <ul>.
 */
export function MealRow({
  icon,
  name,
  time,
  menu,
  value,
  locked = false,
  onChange,
  children,
}: {
  icon: LucideIcon;
  name: string;
  time: string;
  /** What's being served, if the menu is filled in. */
  menu?: string | null;
  value: YesNo | null;
  locked?: boolean;
  onChange?: (value: YesNo) => void;
  /** Small status lines under the time ("Not answered", "Not saved yet", ...). */
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center self-start rounded-full bg-subtle text-foreground-secondary">
        <Icon icon={icon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        <span className="text-sm text-foreground-secondary tabular">{time}</span>
        {menu ? <span className="mt-0.5 text-sm text-foreground">{menu}</span> : null}
        {children ? <div className="flex flex-col text-xs">{children}</div> : null}
      </div>
      {locked ? (
        <ChoiceBadge value={value} />
      ) : (
        <YesNoToggle compact label={`${name}: will you eat?`} value={value} onChange={onChange} />
      )}
    </li>
  );
}
