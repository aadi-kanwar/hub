import { getAuthSessionId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { logActivity } from "./lib/activity";
import { appError } from "./lib/errors";
import { internalMutation, signedInAction, viewerQuery } from "./lib/functions";
import { passwordProblem } from "./lib/inputRules";
import { profileTypeOf, propertyIdsOf } from "./lib/profiles";

/**
 * What the app needs to decide which screen to show. Returns null when
 * signed out, or when the account has been deactivated.
 */
export const me = viewerQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.viewer === null || ctx.viewer.user.status !== "active") return null;
    const { user } = ctx.viewer;
    return {
      name: user.name ?? "",
      phone: user.phone ?? null,
      mustChangePassword: user.mustChangePassword === true,
      profileType: profileTypeOf(user),
      propertyNames: await Promise.all(
        (await propertyIdsOf(ctx, user._id)).map(async (id) => (await ctx.db.get(id))?.name ?? ""),
      ),
    };
  },
});

/**
 * Sets a new password. Needs the current one, except right after the
 * account was created or reset (the temporary password was just used to
 * sign in). Signs out the person's other devices.
 */
export const changePassword = signedInAction({
  args: { currentPassword: v.optional(v.string()), newPassword: v.string() },
  handler: async (ctx, args) => {
    const { userId, phone, mustChangePassword } = ctx.viewer;
    if (!phone) throw appError("INVALID_INPUT", "Your account has no mobile number.");
    if (!mustChangePassword) {
      try {
        await retrieveAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: phone, secret: args.currentPassword ?? "" },
        });
      } catch {
        throw appError("INVALID_INPUT", "Your current password isn't right.");
      }
    }
    const problem = passwordProblem(args.newPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    if (args.newPassword === args.currentPassword) {
      throw appError("WEAK_PASSWORD", "Choose a password different from the current one.");
    }
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.newPassword },
    });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    await ctx.runMutation(internal.users.recordPasswordChanged, { userId });
    return null;
  },
});

export const recordPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user?.mustChangePassword) await ctx.db.patch(userId, { mustChangePassword: false });
    await logActivity(ctx, { type: "password_changed", actor: user, target: user });
    return null;
  },
});
