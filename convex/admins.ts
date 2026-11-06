import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { logActivity } from "./lib/activity";
import { appError } from "./lib/errors";
import { adminAction, adminQuery, internalMutation, internalQuery } from "./lib/functions";
import { displayNameSchema, normalizePhone, passwordProblem } from "./lib/inputRules";

/**
 * Master admin management. The hub is the only place master admins are
 * created and removed. Rules:
 * - a master admin can't deactivate themselves (or reset their own password here);
 * - there is always at least one active master admin.
 */

export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.status !== undefined)
      .sort((a, b) =>
        a.status === b.status ? (a.name ?? "").localeCompare(b.name ?? "") : a.status === "active" ? -1 : 1,
      )
      .map((u) => ({
        userId: u._id,
        name: u.name ?? "",
        phone: u.phone ?? "",
        status: u.status!,
        mustChangePassword: u.mustChangePassword === true,
        createdAt: u.createdAt ?? u._creationTime,
        isYou: u._id === ctx.admin.userId,
      }));
  },
});

/**
 * Adds a master admin with a temporary password they must replace at
 * their first sign-in. Adding the number of a deactivated master admin
 * switches them back on with the new temporary password.
 */
export const create = adminAction({
  args: { name: v.string(), phone: v.string(), temporaryPassword: v.string() },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; reactivated: boolean }> => {
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const problem = passwordProblem(args.temporaryPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);

    const existing = await ctx.runQuery(internal.admins.findByPhone, { phone });
    if (existing !== null) {
      if (existing.status === "active") throw appError("CONFLICT", "This number is already a master admin.");
      await modifyAccountCredentials(ctx, {
        provider: PHONE_PASSWORD_PROVIDER,
        account: { id: phone, secret: args.temporaryPassword },
      });
      await ctx.runMutation(internal.admins.reactivate, {
        userId: existing.userId,
        name: name.data,
        actorId: ctx.admin.userId,
      });
      return { userId: existing.userId, reactivated: true };
    }
    const { user } = await createAccount(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.temporaryPassword },
      profile: { phone },
    });
    await ctx.runMutation(internal.admins.finishCreate, {
      userId: user._id,
      name: name.data,
      actorId: ctx.admin.userId,
    });
    return { userId: user._id, reactivated: false };
  },
});

export const findByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    return user === null ? null : { userId: user._id, status: user.status ?? "inactive" };
  },
});

/** Shared by admins.create and the seed script. */
export async function setUpNewAdmin(
  ctx: Pick<MutationCtx, "db">,
  args: { userId: Id<"users">; name: string; actorId: Id<"users"> | undefined },
) {
  await ctx.db.patch(args.userId, {
    name: args.name,
    status: "active",
    mustChangePassword: true,
    createdAt: Date.now(),
    createdBy: args.actorId,
  });
  const actor = args.actorId ? await ctx.db.get(args.actorId) : null;
  await logActivity(ctx, { type: "admin_added", actor, target: await ctx.db.get(args.userId) });
}

export const finishCreate = internalMutation({
  args: { userId: v.id("users"), name: v.string(), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await setUpNewAdmin(ctx, args);
    return null;
  },
});

export const reactivate = internalMutation({
  args: { userId: v.id("users"), name: v.string(), actorId: v.id("users") },
  handler: async (ctx, { userId, name, actorId }) => {
    await ctx.db.patch(userId, {
      name,
      status: "active",
      mustChangePassword: true,
      deactivatedAt: undefined,
      deactivatedBy: undefined,
    });
    await logActivity(ctx, { type: "admin_reactivated", actor: await ctx.db.get(actorId), target: await ctx.db.get(userId) });
    return null;
  },
});

/**
 * Switches a master admin off. They can't sign in to the hub or get new
 * tool links from this moment; their hub sessions end at once.
 */
export const deactivate = adminAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.runMutation(internal.admins.markInactive, { userId, actorId: ctx.admin.userId });
    await invalidateSessions(ctx, { userId });
    return null;
  },
});

export const markInactive = internalMutation({
  args: { userId: v.id("users"), actorId: v.id("users") },
  handler: async (ctx, { userId, actorId }) => {
    if (userId === actorId) throw appError("FORBIDDEN", "You can't deactivate yourself.");
    const target = await ctx.db.get(userId);
    if (target === null || target.status === undefined) throw appError("NOT_FOUND");
    if (target.status !== "active") throw appError("CONFLICT", "This master admin is already deactivated.");
    const active = await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(2);
    if (active.length < 2) throw appError("FORBIDDEN", "There must always be at least one active master admin.");
    await ctx.db.patch(userId, { status: "inactive", deactivatedAt: Date.now(), deactivatedBy: actorId });
    await logActivity(ctx, {
      type: "admin_deactivated",
      actor: await ctx.db.get(actorId),
      target: await ctx.db.get(userId),
    });
    return null;
  },
});

/**
 * Gives another master admin a new temporary password. They're signed out
 * everywhere and must choose their own at next sign-in.
 */
export const resetPassword = adminAction({
  args: { userId: v.id("users"), temporaryPassword: v.string() },
  handler: async (ctx, { userId, temporaryPassword }) => {
    if (userId === ctx.admin.userId) {
      throw appError("FORBIDDEN", "Use Change password for your own account.");
    }
    const target = await ctx.runQuery(internal.admins.resetTarget, { userId });
    const problem = passwordProblem(temporaryPassword, target.phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: temporaryPassword },
    });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.admins.recordReset, { userId, actorId: ctx.admin.userId });
    return null;
  },
});

export const resetTarget = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user === null || !user.phone || user.status !== "active") throw appError("NOT_FOUND");
    return { phone: user.phone };
  },
});

export const recordReset = internalMutation({
  args: { userId: v.id("users"), actorId: v.id("users") },
  handler: async (ctx, { userId, actorId }) => {
    await ctx.db.patch(userId, { mustChangePassword: true });
    await logActivity(ctx, {
      type: "password_reset",
      actor: await ctx.db.get(actorId),
      target: await ctx.db.get(userId),
    });
    return null;
  },
});

/**
 * Who "Revoke in all apps" is for: another master admin who is already
 * deactivated (an active one would simply get access again on their next
 * launch, so deactivate first).
 */
export const revokeTarget = internalQuery({
  args: { userId: v.id("users"), actorId: v.id("users") },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, { userId, actorId }) => {
    if (userId === actorId) throw appError("FORBIDDEN", "You can't revoke your own access.");
    const target = await ctx.db.get(userId);
    if (target === null || target.status === undefined || !target.phone) throw appError("NOT_FOUND");
    if (target.status === "active") throw appError("CONFLICT", "Deactivate this master admin first.");
    return { phone: target.phone };
  },
});

