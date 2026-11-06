import { History, KeyRound, LayoutGrid, Users, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** In the phone's bottom bar (default true), or under its "More" tab (false). The sidebar shows everything. */
  mobile?: boolean;
};

export const HUB_NAV: NavItem[] = [
  { href: "/tools", label: "Tools", icon: LayoutGrid },
  { href: "/admins", label: "Master admins", icon: Users },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/change-password", label: "Change password", icon: KeyRound, mobile: false },
];
