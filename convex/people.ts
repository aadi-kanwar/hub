import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { logActivity } from "./lib/activity";
import { appError } from "./lib/errors";
import { adminAction, adminMutation, adminQuery, internalMutation, internalQuery } from "./lib/functions";
import { displayNameSchema, normalizePhone, passwordProblem, roomNumberSchema } from "./lib/inputRules";
import { PROFILE_TYPE_LABELS, profileTypeOf, propertyCountProblem, propertyIdsOf } from "./lib/profiles";
import { enqueuePersonSync } from "./lib/syncQueue";
import { vProfileType, type ProfileType } from "./lib/validators";

/**
 * Everyone's profiles. Only a master admin manages them:
 * - adds Admins, Wardens/Managers and Staff (residents can also sign up
 *   themselves with a join code), each with a temporary password;
 * - changes a person's profile type and properties (and moves residents);
 * - deactivates people and resets passwords.
 *
 * Rules: one type per person; a resident belongs to exactly one property, a
 * warden or staff member to one or more, an admin to none (they cover all);
 * one active warden per property; an admin can't change or deactivate
 * themselves; there is always at least one active admin. Every change is
 * sent to the tools, and type/property/status changes end the person's
 * open tool logins.
 */

type ReadCtx = Pick<QueryCtx, "db">;

async function activeAdminCount(ctx: ReadCtx): Promise<number> {
  const active = await ctx.db
    .query("users")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .collect();
  return active.filter((u) => profileTypeOf(u) === "admin").length;
}

/** Checks a set of properties for a type: right count, all open, one warden per property. */
async function checkProperties(
  ctx: ReadCtx,
  type: ProfileType,
  propertyIds: Id<"properties">[],
  userId: Id<"users"> | null,
): Promise<Id<"properties">[]> {
  const unique = [...new Set(propertyIds)];
  const problem = propertyCountProblem(type, unique.length);
  if (problem !== null) throw appError("INVALID_INPUT", problem);
  for (const propertyId of unique) {
    const property = await ctx.db.get(propertyId);
    if (property === null || property.status !== "active") throw appError("NOT_FOUND", "That property isn't open.");
    if (type === "warden") {
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      for (const member of members) {
        if (member.userId === userId) continue;
        const other = await ctx.db.get(member.userId);
        if (other !== null && other.status === "active" && profileTypeOf(other) === "warden") {
          throw appError("CONFLICT", `${property.name} already has a warden (${other.name ?? "someone"}).`);
        }
      }
    }
  }
  return unique;
}

async function setMemberships(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  propertyIds: Id<"properties">[],
  actorId: Id<"users"> | undefined,
) {
  const existing = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const wanted = new Set(propertyIds);
  for (const row of existing) if (!wanted.has(row.propertyId)) await ctx.db.delete(row._id);
  const have = new Set(existing.map((row) => row.propertyId));
  for (const propertyId of propertyIds) {
    if (!have.has(propertyId)) {
      await ctx.db.insert("memberships", { userId, propertyId, createdAt: Date.now(), createdBy: actorId });
    }
  }
}

async function propertyNames(ctx: ReadCtx, ids: Id<"properties">[]) {
  const names: string[] = [];
  for (const id of ids) names.push((await ctx.db.get(id))?.name ?? "?");
  return names.sort();
}

function cleanRoom(type: ProfileType, roomNumber: string | undefined): string | undefined {
  if (type !== "resident" || roomNumber === undefined || roomNumber.trim() === "") return undefined;
  const room = roomNumberSchema.safeParse(roomNumber);
  if (!room.success) throw appError("INVALID_INPUT", room.error.issues[0]?.message);
  return room.data;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = (await ctx.db.query("users").collect()).filter((u) => u.status !== undefined);
    const rows = [];
    for (const u of users) {
      const propertyIds = await propertyIdsOf(ctx, u._id);
      const waiting = await ctx.db
        .query("syncJobs")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .collect();
      rows.push({
        userId: u._id,
        name: u.name ?? "",
        phone: u.phone ?? "",
        profileType: profileTypeOf(u),
        roomNumber: u.roomNumber ?? null,
        status: u.status!,
        mustChangePassword: u.mustChangePassword === true,
        createdAt: u.createdAt ?? u._creationTime,
        propertyIds,
        propertyNames: await propertyNames(ctx, propertyIds),
        isYou: u._id === ctx.admin.userId,
        syncWaiting: waiting.map((job) => ({ toolId: job.toolId, failing: job.attempts > 0 })),
      });
    }
    return rows.sort((a, b) =>
      a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
    );
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

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

/**
 * Adds a person with a temporary password they must replace at first
 * sign-in. Adding the number of a deactivated person switches them back on
 * with the new type, properties and temporary password.
 */
export const create = adminAction({
  args: {
    name: v.string(),
    phone: v.string(),
    profileType: vProfileType,
    propertyIds: v.array(v.id("properties")),
    roomNumber: v.optional(v.string()),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; reactivated: boolean }> => {
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const problem = passwordProblem(args.temporaryPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    const details = {
      name: name.data,
      profileType: args.profileType,
      propertyIds: args.propertyIds,
      roomNumber: cleanRoom(args.profileType, args.roomNumber),
      actorId: ctx.admin.userId,
    };
    // Checked before any account is made, and again when it's saved.
    await ctx.runQuery(internal.people.checkNewPerson, { ...details, userId: undefined });

    const existing = await ctx.runQuery(internal.people.findByPhone, { phone });
    if (existing !== null) {
      if (existing.status === "active") throw appError("CONFLICT", "This number already has an active profile.");
      await modifyAccountCredentials(ctx, {
        provider: PHONE_PASSWORD_PROVIDER,
        account: { id: phone, secret: args.temporaryPassword },
      });
      await ctx.runMutation(internal.people.finishCreate, { ...details, userId: existing.userId, reactivate: true });
      return { userId: existing.userId, reactivated: true };
    }
    const { user } = await createAccount(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.temporaryPassword },
      profile: { phone },
    });
    await ctx.runMutation(internal.people.finishCreate, { ...details, userId: user._id, reactivate: false });
    return { userId: user._id, reactivated: false };
  },
});

const vNewPerson = {
  name: v.string(),
  profileType: vProfileType,
  propertyIds: v.array(v.id("properties")),
  roomNumber: v.optional(v.string()),
  actorId: v.id("users"),
};

export const checkNewPerson = internalQuery({
  args: { ...vNewPerson, userId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await checkProperties(ctx, args.profileType, args.propertyIds, args.userId ?? null);
    return null;
  },
});

export const finishCreate = internalMutation({
  args: { ...vNewPerson, userId: v.id("users"), reactivate: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const propertyIds = await checkProperties(ctx, args.profileType, args.propertyIds, args.userId);
    const before = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, {
      name: args.name,
      status: "active",
      profileType: args.profileType,
      roomNumber: args.roomNumber,
      mustChangePassword: true,
      ...(args.reactivate
        ? { deactivatedAt: undefined, deactivatedBy: undefined }
        : { createdAt: Date.now(), createdBy: args.actorId }),
    });
    await setMemberships(ctx, args.userId, propertyIds, args.actorId);
    await logActivity(ctx, {
      type: args.reactivate ? "person_reactivated" : "person_added",
      actor: await ctx.db.get(args.actorId),
      target: await ctx.db.get(args.userId),
      detail: PROFILE_TYPE_LABELS[args.profileType],
    });
    await enqueuePersonSync(ctx, args.userId, {
      type: args.profileType,
      previousType: before?.profileType,
      revoke: args.reactivate,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Changing
// ---------------------------------------------------------------------------

/**
 * Changes a person's profile type, properties and (for residents) room.
 * Moving a resident to another PG is this too. Their open tool logins end,
 * so their next "Open" gets the new role.
 */
export const update = adminMutation({
  args: {
    userId: v.id("users"),
    profileType: vProfileType,
    propertyIds: v.array(v.id("properties")),
    roomNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.userId);
    if (target === null || target.status !== "active") throw appError("NOT_FOUND");
    const before = profileTypeOf(target);
    if (args.userId === ctx.admin.userId && args.profileType !== before) {
      throw appError("FORBIDDEN", "You can't change your own profile type.");
    }
    if (before === "admin" && args.profileType !== "admin" && (await activeAdminCount(ctx)) < 2) {
      throw appError("FORBIDDEN", "There must always be at least one active admin.");
    }
    const propertyIds = await checkProperties(ctx, args.profileType, args.propertyIds, args.userId);
    const beforeIds = await propertyIdsOf(ctx, args.userId);
    const roomNumber = cleanRoom(args.profileType, args.roomNumber);

    const typeChanged = before !== args.profileType;
    const propertiesChanged =
      beforeIds.length !== propertyIds.length || beforeIds.some((id) => !propertyIds.includes(id));
    const roomChanged = (target.roomNumber ?? undefined) !== roomNumber;
    if (!typeChanged && !propertiesChanged && !roomChanged) return null;

    await ctx.db.patch(args.userId, { profileType: args.profileType, roomNumber });
    await setMemberships(ctx, args.userId, propertyIds, ctx.admin.userId);
    const after = await ctx.db.get(args.userId);
    if (typeChanged) {
      await logActivity(ctx, {
        type: "type_changed",
        actor: ctx.admin.user,
        target: after,
        detail: `${PROFILE_TYPE_LABELS[before]} → ${PROFILE_TYPE_LABELS[args.profileType]}`,
      });
    }
    if (propertiesChanged) {
      await logActivity(ctx, {
        type: "properties_changed",
        actor: ctx.admin.user,
        target: after,
        detail: (await propertyNames(ctx, propertyIds)).join(", ") || "All properties",
      });
    }
    await enqueuePersonSync(ctx, args.userId, {
      type: args.profileType,
      previousType: before,
      revoke: typeChanged || propertiesChanged,
    });
    return null;
  },
});

/**
 * Switches a person off. They can't sign in to the hub or get tool links
 * from this moment; their hub logins end at once, and the tools are told to
 * end theirs and switch them off too. Their history in the tools is kept.
 */
export const deactivate = adminAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.runMutation(internal.people.markInactive, { userId, actorId: ctx.admin.userId });
    await invalidateSessions(ctx, { userId });
    return null;
  },
});

export const markInactive = internalMutation({
  args: { userId: v.id("users"), actorId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId, actorId }) => {
    if (userId === actorId) throw appError("FORBIDDEN", "You can't deactivate yourself.");
    const target = await ctx.db.get(userId);
    if (target === null || target.status === undefined) throw appError("NOT_FOUND");
    if (target.status !== "active") throw appError("CONFLICT", "This person is already deactivated.");
    const type = profileTypeOf(target);
    if (type === "admin" && (await activeAdminCount(ctx)) < 2) {
      throw appError("FORBIDDEN", "There must always be at least one active admin.");
    }
    await ctx.db.patch(userId, { status: "inactive", deactivatedAt: Date.now(), deactivatedBy: actorId });
    await logActivity(ctx, {
      type: type === "admin" ? "admin_deactivated" : "person_deactivated",
      actor: await ctx.db.get(actorId),
      target: await ctx.db.get(userId),
    });
    await enqueuePersonSync(ctx, userId, { type, revoke: true });
    return null;
  },
});

/**
 * Gives a person a new temporary password. They're signed out of the hub
 * and the tools, and must choose their own at next sign-in.
 */
export const resetPassword = adminAction({
  args: { userId: v.id("users"), temporaryPassword: v.string() },
  handler: async (ctx, { userId, temporaryPassword }) => {
    if (userId === ctx.admin.userId) {
      throw appError("FORBIDDEN", "Use Change password for your own account.");
    }
    const target = await ctx.runQuery(internal.people.resetTarget, { userId });
    const problem = passwordProblem(temporaryPassword, target.phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: temporaryPassword },
    });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.people.recordReset, { userId, actorId: ctx.admin.userId });
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
  returns: v.null(),
  handler: async (ctx, { userId, actorId }) => {
    await ctx.db.patch(userId, { mustChangePassword: true });
    const target = await ctx.db.get(userId);
    await logActivity(ctx, { type: "password_reset", actor: await ctx.db.get(actorId), target });
    if (target !== null) await enqueuePersonSync(ctx, userId, { type: profileTypeOf(target), revoke: true });
    return null;
  },
});

/** Sends a person to the tools again now (e.g. after a tool was down). */
export const resync = adminMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const target: Doc<"users"> | null = await ctx.db.get(userId);
    if (target === null || target.status === undefined) throw appError("NOT_FOUND");
    await enqueuePersonSync(ctx, userId, { type: profileTypeOf(target), revoke: target.status !== "active" });
    return null;
  },
});

/** Shared by the seed script: the first master admin. */
export async function setUpFirstAdmin(ctx: Pick<MutationCtx, "db">, args: { userId: Id<"users">; name: string }) {
  await ctx.db.patch(args.userId, {
    name: args.name,
    status: "active",
    profileType: "admin",
    mustChangePassword: true,
    createdAt: Date.now(),
  });
  await logActivity(ctx, { type: "admin_added", target: await ctx.db.get(args.userId) });
}
