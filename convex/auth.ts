import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, retrieveAccount } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { FAILED_ATTEMPTS_LIMIT } from "./authLimits";
import { appError } from "./lib/errors";
import { normalizePhone } from "./lib/inputRules";

export const PHONE_PASSWORD_PROVIDER = "phone-password";

/** A hub login lasts at most 8 hours, and ends after 2 hours without using the hub. */
export const SESSION_TOTAL_MS = 8 * 60 * 60 * 1000;
export const SESSION_INACTIVE_MS = 2 * 60 * 60 * 1000;

/** Password hashing shared by sign-in and by master admins creating accounts. */
export const passwordCrypto = {
  async hashSecret(password: string) {
    return await new Scrypt().hash(password);
  },
  async verifySecret(password: string, hash: string) {
    return await new Scrypt().verify(hash, password);
  },
};

/**
 * Mobile number + password login (the same password login as the Staff
 * app). There is NO sign-up: accounts are created by a master admin
 * (convex/admins.ts) or by the seed script (convex/seed.ts). The identifier
 * is the number in E.164 form (default country India, +91). Every failure
 * returns the same SIGN_IN_FAILED message so it never reveals whether a
 * number has an account.
 *
 * The browser calls `signIn("phone-password", { phone, password })`.
 */
const PhonePassword = ConvexCredentials<DataModel>({
  id: PHONE_PASSWORD_PROVIDER,
  authorize: async (params, ctx) => {
    const phone = typeof params.phone === "string" ? normalizePhone(params.phone) : null;
    if (phone === null) throw appError("INVALID_PHONE");
    const password = typeof params.password === "string" ? params.password : "";
    if (params.flow !== undefined && params.flow !== "signIn") throw appError("FORBIDDEN");

    const gate = await ctx.runMutation(internal.authLimits.checkAttempt, { phone });
    if (!gate.allowed) throw appError("TOO_MANY_ATTEMPTS");

    let userId;
    try {
      if (password.length === 0) throw new Error("empty");
      const { user } = await retrieveAccount(ctx, {
        provider: PHONE_PASSWORD_PROVIDER,
        account: { id: phone, secret: password },
      });
      userId = user._id;
    } catch {
      await ctx.runMutation(internal.authLimits.recordFailure, { phone });
      throw appError("SIGN_IN_FAILED");
    }
    if (!(await ctx.runQuery(internal.access.canSignIn, { userId }))) {
      await ctx.runMutation(internal.authLimits.recordFailure, { phone });
      throw appError("SIGN_IN_FAILED");
    }
    await ctx.runMutation(internal.authLimits.recordSuccess, { phone, userId });
    return { userId };
  },
  crypto: passwordCrypto,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PhonePassword],
  session: { totalDurationMs: SESSION_TOTAL_MS, inactiveDurationMs: SESSION_INACTIVE_MS },
  signIn: {
    // Convex Auth's own per-account limit, kept above ours so ours applies first.
    maxFailedAttempsPerHour: FAILED_ATTEMPTS_LIMIT * 4 + 10,
  },
});
