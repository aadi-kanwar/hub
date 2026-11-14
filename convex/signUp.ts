import { v } from "convex/values";
import { logActivity } from "./lib/activity";
import { internalMutation } from "./lib/functions";
import { enqueuePersonSync } from "./lib/syncQueue";

/**
 * Finishes a resident's sign-up (called by the login provider once the
 * account exists): an active Resident of the join code's property, sent to
 * the tools straight away. Internal only.
 */
export const finish = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    roomNumber: v.string(),
    propertyId: v.id("properties"),
  },
  returns: v.null(),
  handler: async (ctx, { userId, name, roomNumber, propertyId }) => {
    const now = Date.now();
    await ctx.db.patch(userId, {
      name,
      roomNumber,
      status: "active",
      profileType: "resident",
      createdAt: now,
    });
    await ctx.db.insert("memberships", { userId, propertyId, createdAt: now });
    const property = await ctx.db.get(propertyId);
    await logActivity(ctx, { type: "signed_up", actor: await ctx.db.get(userId), detail: property?.name });
    await enqueuePersonSync(ctx, userId, { type: "resident", revoke: false });
    return null;
  },
});
