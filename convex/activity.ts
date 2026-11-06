import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { logActivity } from "./lib/activity";
import { appError } from "./lib/errors";
import { adminQuery, internalMutation } from "./lib/functions";
import { vActivityType } from "./lib/validators";

/** The activity log, newest first, optionally only one kind of entry. */
export const list = adminQuery({
  args: { paginationOpts: paginationOptsValidator, type: v.optional(vActivityType) },
  handler: async (ctx, { paginationOpts, type }) => {
    const query =
      type === undefined
        ? ctx.db.query("activityLog").withIndex("by_createdAt")
        : ctx.db.query("activityLog").withIndex("by_type_createdAt", (q) => q.eq("type", type));
    return await query.order("desc").paginate(paginationOpts);
  },
});

/** Logs a tool launch (convex/launch.ts). Refuses if the admin was deactivated meanwhile. */
export const recordLaunch = internalMutation({
  args: { userId: v.id("users"), toolId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, toolId }) => {
    const user = await ctx.db.get(userId);
    if (user === null || user.status !== "active") throw appError("ACCOUNT_DISABLED");
    await logActivity(ctx, { type: "tool_launched", actor: user, toolId });
    return null;
  },
});
