import { DownloadCloud, Building2, History, KeyRound, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import type { ProfileType } from "@convex/lib/validators";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** In the phone's bottom bar (default true), or under its "More" tab (false). The sidebar shows everything. */
  mobile?: boolean;
  /** Only master admins see it (and the page itself refuses everyone else). */
  adminOnly?: boolean;
};

export const HUB_NAV: NavItem[] = [
  { href: "/tools", label: "Tools", icon: LayoutGrid },
  { href: "/people", label: "People", icon: Users, adminOnly: true },
  { href: "/properties", label: "Properties", icon: Building2, adminOnly: true },
  { href: "/activity", label: "Activity", icon: History, adminOnly: true, mobile: false },
  { href: "/import", label: "Import from tools", icon: DownloadCloud, adminOnly: true, mobile: false },
  { href: "/change-password", label: "Change password", icon: KeyRound, mobile: false },
];

export function navFor(type: ProfileType): NavItem[] {
  return HUB_NAV.filter((item) => type === "admin" || !item.adminOnly);
}

/** Pages only master admins may open. */
export function isAdminPath(pathname: string): boolean {
  return HUB_NAV.some((item) => item.adminOnly && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
}
