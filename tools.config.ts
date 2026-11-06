/**
 * The tools on the Admin Hub's launcher. Adding a future tool = adding one
 * entry here (and setting up single sign-on in that tool).
 *
 * - id:          short name; it's the `aud` of the sign-in ticket, and the
 *                tool checks it, so it must match what the tool expects.
 * - icon:        any icon name from https://lucide.dev/icons (e.g. "utensils").
 * - appUrl:      the tool's website address, without a trailing slash.
 * - ssoPath:     the tool's page that accepts the hub's sign-in ticket.
 *
 * Read by both the website (cards) and the backend (where "Open" goes).
 */
export type ToolConfig = {
  id: string;
  name: string;
  description: string;
  icon: string;
  appUrl: string;
  ssoPath: string;
};

export const TOOLS = [
  {
    id: "mealsync",
    name: "Dine (MealSync)",
    description: "Meal planning and headcounts for the PG.",
    icon: "utensils",
    appUrl: "https://mealsync.vercel.app",
    ssoPath: "/sso",
  },
  {
    id: "staff",
    name: "Staff",
    description: "Staff attendance, salaries and payments.",
    icon: "users",
    appUrl: "https://staff.vercel.app",
    ssoPath: "/sso",
  },
] as const satisfies readonly ToolConfig[];

export type ToolId = (typeof TOOLS)[number]["id"];

export function findTool(id: string): ToolConfig | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
