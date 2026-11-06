import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ActivityType } from "./validators";

/**
 * Appends one entry to the activity log. Never put passwords, tickets or
 * keys in it.
 */
export async function logActivity(
  ctx: Pick<MutationCtx, "db">,
  entry: {
    type: ActivityType;
    actor?: Doc<"users"> | null;
    target?: Doc<"users"> | null;
    phone?: string;
    toolId?: string;
  },
): Promise<void> {
  await ctx.db.insert("activityLog", {
    type: entry.type,
    actorId: entry.actor?._id,
    actorName: entry.actor?.name,
    targetId: entry.target?._id,
    targetName: entry.target?.name,
    phone: entry.phone ?? entry.target?.phone,
    toolId: entry.toolId,
    createdAt: Date.now(),
  });
}
