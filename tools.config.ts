/**
 * The tools on the Livoza Hub. Adding a tool = adding one entry here (and
 * setting up single sign-on and sync in that tool).
 *
 * - id:          short name; it's the `aud` of every ticket and request the
 *                hub signs for the tool, so it must match what the tool expects.
 * - icon:        any icon name from https://lucide.dev/icons (e.g. "utensils").
 * - appUrl:      the tool's website address, without a trailing slash.
 * - ssoPath:     the tool's page that accepts the hub's sign-in ticket.
 * - backendUrl:  the tool's Convex HTTP address (https://<deployment>.convex.site).
 *                The hub calls /sso/sync, /sso/revoke and /sso/export there;
 *                each accepts only requests signed by the hub.
 * - roles:       which role in the tool each hub profile type gets. null = no
 *                access: the card is hidden and no ticket is ever signed.
 * - labels:      optional card name/description per profile type, e.g. a
 *                friendlier name for staff.
 *
 * Read by both the website (cards) and the backend (tickets and sync).
 */
export type ProfileTypeKey = "admin" | "warden" | "staff" | "resident";

export type ToolConfig = {
  id: string;
  name: string;
  description: string;
  icon: string;
  appUrl: string;
  ssoPath: string;
  backendUrl: string;
  roles: Record<ProfileTypeKey, string | null>;
  labels?: Partial<Record<ProfileTypeKey, { name: string; description?: string }>>;
};

export const TOOLS = [
  {
    id: "mealsync",
    name: "Dine",
    description: "Meal planning and headcounts for the PG.",
    icon: "utensils",
    appUrl: "https://dine.livoza.org",
    ssoPath: "/sso",
    backendUrl: "https://decisive-axolotl-579.convex.site",
    roles: { admin: "admin", warden: "warden", staff: null, resident: "resident" },
    labels: { resident: { name: "Dine", description: "Tell the kitchen which meals you'll eat." } },
  },
  {
    id: "staff",
    name: "Staff",
    description: "Staff attendance, salaries and payments.",
    icon: "users",
    appUrl: "https://clan.livoza.org",
    ssoPath: "/sso",
    backendUrl: "https://pleasant-labrador-141.convex.site",
    roles: { admin: "admin", warden: null, staff: "staff", resident: null },
    labels: { staff: { name: "My Attendance & Pay", description: "Your attendance and salary." } },
  },
  {
    id: "crate",
    name: "Crate",
    description: "Kitchen purchases, usage & price history",
    icon: "shopping-basket",
    appUrl: "https://crate.livoza.org",
    ssoPath: "/sso",
    backendUrl: "https://agreeable-koala-751.convex.site",
    roles: { admin: "admin", warden: "manager", staff: null, resident: null },
  },
] as const satisfies readonly ToolConfig[];

export type ToolId = (typeof TOOLS)[number]["id"];

export function findTool(id: string): ToolConfig | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** The tool's role for a profile type, or null for no access. */
export function toolRoleFor(tool: ToolConfig, type: ProfileTypeKey): string | null {
  return tool.roles[type];
}

/** The tools a profile type may open, with the name and description it sees. */
export function toolsFor(type: ProfileTypeKey) {
  return TOOLS.filter((tool: ToolConfig) => toolRoleFor(tool, type) !== null).map((tool: ToolConfig) => ({
    id: tool.id,
    icon: tool.icon,
    name: tool.labels?.[type]?.name ?? tool.name,
    description: tool.labels?.[type]?.description ?? tool.description,
  }));
}
