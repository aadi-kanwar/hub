import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ProfileType } from "./validators";

/** A person's profile type. Rows from before profile types were all master admins. */
export function profileTypeOf(user: Pick<Doc<"users">, "profileType">): ProfileType {
  return user.profileType ?? "admin";
}

export const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
  admin: "Admin",
  warden: "Warden/Manager",
  staff: "Staff",
  resident: "Resident",
};

/**
 * How long a hub login lasts, by profile type. Convex Auth has one setting
 * for the whole hub (the longest, in convex/auth.ts); shorter limits are
 * applied by getViewer in lib/functions.ts.
 */
export const SESSION_LIMITS: Record<ProfileType, { totalMs: number; inactiveMs: number }> = {
  admin: { totalMs: 8 * 60 * 60 * 1000, inactiveMs: 2 * 60 * 60 * 1000 },
  warden: { totalMs: 30 * 24 * 60 * 60 * 1000, inactiveMs: 7 * 24 * 60 * 60 * 1000 },
  staff: { totalMs: 30 * 24 * 60 * 60 * 1000, inactiveMs: 7 * 24 * 60 * 60 * 1000 },
  resident: { totalMs: 30 * 24 * 60 * 60 * 1000, inactiveMs: 7 * 24 * 60 * 60 * 1000 },
};

/** Which property counts a type may have: residents exactly one, wardens/staff at least one, admins none. */
export function propertyCountProblem(type: ProfileType, count: number): string | null {
  if (type === "admin") return count === 0 ? null : "Admins cover every property; don't assign any.";
  if (type === "resident") return count === 1 ? null : "A resident belongs to exactly one property.";
  return count >= 1 ? null : "Choose at least one property.";
}

/** The ids of the active properties a person belongs to. */
export async function propertyIdsOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<Id<"properties">[]> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const ids: Id<"properties">[] = [];
  for (const row of rows) {
    const property = await ctx.db.get(row.propertyId);
    if (property !== null && property.status === "active") ids.push(row.propertyId);
  }
  return ids;
}
