import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import { internalMutation } from "./lib/functions";

/**
 * Sign-in lockout (internal only; called by the login provider).
 *
 * 5 failed attempts for a phone number within 15 minutes lock that number
 * out for 15 minutes. Counted whether or not the number has an account, so
 * the lock itself never reveals who is a master admin. A successful sign-in
 * clears the count. Every failure is written to the activity log.
 */
export const FAILED_ATTEMPTS_LIMIT = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const COUNT_WINDOW_MS = 15 * 60 * 1000;

const failKey = (phone: string) => `fail:${phone}`;

async function row(ctx: Pick<MutationCtx, "db">, phone: string) {
  return await ctx.db
    .query("authAttemptLimits")
    .withIndex("by_key", (q) => q.eq("key", failKey(phone)))
    .unique();
}

export const checkAttempt = internalMutation({
  args: { phone: v.string() },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, { phone }) => {
    const existing = await row(ctx, phone);
    const locked = existing?.lockedUntil !== undefined && existing.lockedUntil > Date.now();
    if (locked) await logActivity(ctx, { type: "login_failed", phone });
    return { allowed: !locked };
  },
});

export const recordFailure = internalMutation({
  args: { phone: v.string() },
  returns: v.null(),
  handler: async (ctx, { phone }) => {
    const now = Date.now();
    const existing = await row(ctx, phone);
    const fresh =
      existing === null ||
      now - existing.windowStart >= COUNT_WINDOW_MS ||
      (existing.lockedUntil !== undefined && existing.lockedUntil <= now);
    const count = fresh ? 1 : existing.count + 1;
    const fields = {
      windowStart: fresh ? now : existing.windowStart,
      count,
      lockedUntil: count >= FAILED_ATTEMPTS_LIMIT ? now + LOCKOUT_MS : undefined,
    };
    if (existing === null) await ctx.db.insert("authAttemptLimits", { key: failKey(phone), ...fields });
    else await ctx.db.patch(existing._id, fields);
    await logActivity(ctx, { type: "login_failed", phone });
    return null;
  },
});

/** A successful sign-in: clears the count and records the login. */
export const recordSuccess = internalMutation({
  args: { phone: v.string(), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { phone, userId }) => {
    const existing = await row(ctx, phone);
    if (existing !== null) await ctx.db.delete(existing._id);
    const user = await ctx.db.get(userId);
    await logActivity(ctx, { type: "login", actor: user, phone });
    return null;
  },
});
