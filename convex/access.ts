import { v } from "convex/values";
import { internalQuery, requireAdmin, requireMember, requireUser, type SignedInViewer } from "./lib/functions";
import { profileTypeOf } from "./lib/profiles";
import { vProfileType } from "./lib/validators";

/**
 * Permission checks for actions (signedInAction / adminAction in
 * lib/functions.ts) and for the login provider. Internal: never callable
 * from a browser. They run with the caller's own login.
 */

const vActionViewer = v.object({
  userId: v.id("users"),
  name: v.string(),
  phone: v.string(),
  mustChangePassword: v.boolean(),
  profileType: vProfileType,
});

function describe({ userId, user }: SignedInViewer) {
  return {
    userId,
    name: user.name ?? "",
    phone: user.phone ?? "",
    mustChangePassword: user.mustChangePassword === true,
    profileType: profileTypeOf(user),
  };
}

export const viewerForAction = internalQuery({
  args: {},
  returns: vActionViewer,
  handler: async (ctx) => describe(await requireUser(ctx)),
});

export const memberForAction = internalQuery({
  args: {},
  returns: vActionViewer,
  handler: async (ctx) => describe(await requireMember(ctx)),
});

export const adminForAction = internalQuery({
  args: {},
  returns: vActionViewer,
  handler: async (ctx) => describe(await requireAdmin(ctx)),
});

/** Only active people may sign in. */
export const canSignIn = internalQuery({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user !== null && user.status === "active";
  },
});
