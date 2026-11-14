/**
 * The ONLY place in the backend allowed to use Convex's raw `query`,
 * `mutation`, `action` and internal builders. Every other file builds its
 * functions from the wrappers here, so no function can skip the permission
 * checks. (Enforced by ESLint and by convex/tests/enforcement.test.ts.)
 *
 * Wrappers that browsers can call:
 *   viewerQuery          - signed in or not; ctx.viewer is null when signed out
 *   signedInAction       - any active person, even before they replaced
 *                          their temporary password (the password change itself)
 *   memberQuery/Action   - any active person who has chosen their own
 *                          password (ctx.member)
 *   adminQuery/Mutation  - an active master admin (profile type "admin") who
 *   adminAction            has chosen their own password (ctx.admin)
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * All mutation wrappers make `activityLog` append-only: patch / replace /
 * delete on it throws.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { customAction, customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
  action as rawAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";
import { profileTypeOf, SESSION_LIMITS } from "./profiles";
import type { ProfileType } from "./validators";

type ReadCtx = Pick<QueryCtx, "db" | "auth">;

export type SignedInViewer = { userId: Id<"users">; user: Doc<"users"> };

/**
 * The signed-in account, or null. Identity always comes from the session,
 * never from arguments. The session must still exist: a deactivation,
 * password reset or change deletes sessions, and their tokens stop working at once.
 *
 * Logins last as long as the person's profile type allows (lib/profiles.ts):
 * Convex Auth keeps every login for the longest time, and a master admin's
 * login is treated as ended here once it's older than 8 hours or unused for 2.
 */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null) return null;
  const session = await ctx.db.get(sessionId);
  if (session === null) return null;
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  if (!(await sessionWithinLimits(ctx, session, profileTypeOf(user)))) return null;
  return { userId, user };
}

async function sessionWithinLimits(ctx: ReadCtx, session: Doc<"authSessions">, type: ProfileType) {
  const limits = SESSION_LIMITS[type];
  const now = Date.now();
  if (now - session._creationTime > limits.totalMs) return false;
  // A login's token is renewed while it's in use, so its newest refresh token
  // shows when it was last used.
  const latest = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
    .order("desc")
    .first();
  const lastUsed = latest?._creationTime ?? session._creationTime;
  return now - lastUsed <= limits.inactiveMs;
}

/** An active person (their temporary password may not be replaced yet). */
export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  if (viewer.user.status !== "active") throw appError("ACCOUNT_DISABLED");
  return viewer;
}

/** An active person who has chosen their own password. */
export async function requireMember(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.mustChangePassword) throw appError("PASSWORD_CHANGE_REQUIRED");
  return viewer;
}

/** An active master admin who has chosen their own password. */
export async function requireAdmin(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await requireMember(ctx);
  if (profileTypeOf(viewer.user) !== "admin") throw appError("FORBIDDEN");
  return viewer;
}

// ---------------------------------------------------------------------------
// Append-only tables.
// ---------------------------------------------------------------------------

const appendOnlyRules = {
  activityLog: { modify: async () => false },
};

/** Exported for tests; every mutation wrapper below uses it. */
export function guardedDb(ctx: MutationCtx): MutationCtx["db"] {
  return wrapDatabaseWriter<MutationCtx, DataModel>(ctx, ctx.db, appendOnlyRules);
}

// ---------------------------------------------------------------------------
// Public wrappers (callable from the browser).
// ---------------------------------------------------------------------------

export const viewerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await getViewer(ctx) })),
);

export const memberQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ member: await requireMember(ctx) })),
);

export const adminQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx), db: guardedDb(ctx) })),
);

// Actions have no database access, so they check the caller through these
// internal queries (convex/access.ts), which run the same helpers as above.

export type ActionViewer = {
  userId: Id<"users">;
  name: string;
  phone: string;
  mustChangePassword: boolean;
  profileType: ProfileType;
};

const viewerForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:viewerForAction",
);
const memberForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:memberForAction",
);
const adminForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:adminForAction",
);

export const signedInAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ viewer: await ctx.runQuery(viewerForAction, {}) })),
);

export const memberAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ member: await ctx.runQuery(memberForAction, {}) })),
);

export const adminAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ admin: await ctx.runQuery(adminForAction, {}) })),
);

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;
