import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount, retrieveAccount, type GenericActionCtxWithAuthConfig } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { FAILED_ATTEMPTS_LIMIT } from "./authLimits";
import { appError } from "./lib/errors";
import { displayNameSchema, normalizePhone, passwordProblem, roomNumberSchema } from "./lib/inputRules";

export const PHONE_PASSWORD_PROVIDER = "phone-password";

/**
 * The longest a hub login can last (residents, staff and wardens): 30 days,
 * or 7 days without using the hub. A master admin's login is cut to 8 hours
 * (2 idle) by getViewer in lib/functions.ts; see SESSION_LIMITS.
 */
export const SESSION_TOTAL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Mobile number + password login for everyone. The identifier is the number
 * in E.164 form (default country India, +91). Every failure returns the same
 * SIGN_IN_FAILED message so it never reveals whether a number has an account.
 *
 * Sign in:  `signIn("phone-password", { phone, password })`
 * Sign up:  `signIn("phone-password", { flow: "signUp", phone, password,
 *            name, joinCode, roomNumber })` - residents only: the join code
 *            picks their property. Admins, wardens and staff are added by a
 *            master admin (convex/people.ts) with a temporary password.
 *
 * Signing up with a number that already has an account behaves like a
 * sign-in (the details sent are ignored), so sign-up never reveals who has
 * an account. A wrong join code counts as a failed attempt.
 */
const PhonePassword = ConvexCredentials<DataModel>({
  id: PHONE_PASSWORD_PROVIDER,
  authorize: async (params, ctx) => {
    const phone = typeof params.phone === "string" ? normalizePhone(params.phone) : null;
    if (phone === null) throw appError("INVALID_PHONE");
    const password = typeof params.password === "string" ? params.password : "";
    const flow = params.flow ?? "signIn";
    if (flow !== "signIn" && flow !== "signUp") throw appError("FORBIDDEN");

    const gate = await ctx.runMutation(internal.authLimits.checkAttempt, { phone });
    if (!gate.allowed) throw appError("TOO_MANY_ATTEMPTS");

    if (flow === "signUp") {
      const name = displayNameSchema.safeParse(params.name);
      if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
      const room = roomNumberSchema.safeParse(params.roomNumber);
      if (!room.success) throw appError("INVALID_INPUT", room.error.issues[0]?.message);
      const problem = passwordProblem(password, phone);
      if (problem !== null) throw appError("WEAK_PASSWORD", problem);
      const property = await ctx.runQuery(internal.properties.findByJoinCode, {
        joinCode: typeof params.joinCode === "string" ? params.joinCode : "",
      });
      if (property === null) {
        await ctx.runMutation(internal.authLimits.recordFailure, { phone });
        throw appError("INVALID_JOIN_CODE");
      }
      if (!(await accountExists(ctx, phone))) {
        let userId;
        try {
          const { user } = await createAccount(ctx, {
            provider: PHONE_PASSWORD_PROVIDER,
            account: { id: phone, secret: password },
            profile: { phone },
          });
          userId = user._id;
        } catch {
          // Most likely the same number signed up a moment ago.
          await ctx.runMutation(internal.authLimits.recordFailure, { phone });
          throw appError("SIGN_IN_FAILED");
        }
        await ctx.runMutation(internal.signUp.finish, {
          userId,
          name: name.data,
          roomNumber: room.data,
          propertyId: property.propertyId,
        });
        await ctx.runMutation(internal.authLimits.recordSuccess, { phone, userId });
        return { userId };
      }
      // Number already registered: continue as a sign-in.
    }

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

async function accountExists(ctx: GenericActionCtxWithAuthConfig<DataModel>, phone: string): Promise<boolean> {
  try {
    await retrieveAccount(ctx, { provider: PHONE_PASSWORD_PROVIDER, account: { id: phone } });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "InvalidAccountId") return false;
    throw error;
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PhonePassword],
  session: { totalDurationMs: SESSION_TOTAL_MS, inactiveDurationMs: SESSION_INACTIVE_MS },
  signIn: {
    // Convex Auth's own per-account limit, kept above ours so ours applies first.
    maxFailedAttempsPerHour: FAILED_ATTEMPTS_LIMIT * 4 + 10,
  },
});
