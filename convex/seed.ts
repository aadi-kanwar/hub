/**
 * Creates the FIRST master admin. INTERNAL: browsers can never call it.
 * Set SEED_ADMIN_NAME, SEED_ADMIN_PHONE and SEED_ADMIN_PASSWORD on the
 * Convex deployment, then run:
 *
 *   npx convex run seed:createFirstAdmin
 *
 * (`npm run seed` does the same.) It refuses to run once any master admin
 * exists, so it can't be used to take over the hub later. The password is a
 * temporary one: the admin must choose their own at first sign-in. Remove
 * SEED_ADMIN_PASSWORD from the deployment afterwards.
 */
import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { setUpFirstAdmin } from "./people";
import { appError } from "./lib/errors";
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { displayNameSchema, normalizePhone, passwordProblem } from "./lib/inputRules";

export const createFirstAdmin = internalAction({
  args: {},
  handler: async (ctx): Promise<{ message: string }> => {
    const name = displayNameSchema.safeParse(process.env.SEED_ADMIN_NAME ?? "");
    if (!name.success) throw appError("INVALID_INPUT", "Set SEED_ADMIN_NAME to the admin's full name.");
    const phone = normalizePhone(process.env.SEED_ADMIN_PHONE ?? "");
    if (phone === null) throw appError("INVALID_PHONE", "Set SEED_ADMIN_PHONE to a valid mobile number.");
    const password = process.env.SEED_ADMIN_PASSWORD ?? "";
    const problem = passwordProblem(password, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", `SEED_ADMIN_PASSWORD: ${problem}`);
    if (await ctx.runQuery(internal.seed.adminExists, {})) {
      throw appError("CONFLICT", "A master admin already exists. This step only works once.");
    }
    const { user } = await createAccount(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: password },
      profile: { phone },
    });
    await ctx.runMutation(internal.seed.finishFirstAdmin, { userId: user._id, name: name.data });
    return {
      message: `${name.data} (${phone}) is now a master admin. Sign in with that number and password, then choose a new password. Remove SEED_ADMIN_PASSWORD from the deployment now.`,
    };
  },
});

export const adminExists = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) =>
    (await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first()) !== null,
});

export const finishFirstAdmin = internalMutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    await setUpFirstAdmin(ctx, { userId, name });
    return null;
  },
});
