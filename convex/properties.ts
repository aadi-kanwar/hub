import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, internalMutation, internalQuery } from "./lib/functions";
import { propertyNameSchema } from "./lib/inputRules";
import { enqueuePropertySync } from "./lib/syncQueue";

/**
 * Organisations and properties (PGs). The hub keeps the master list; each
 * tool stores the hub's property id next to its own property row.
 *
 * Every property has a join code. Residents sign up with it. The code stays
 * the same until an admin changes it, and an old code stops working at once.
 */

// Letters and digits that are hard to confuse when read out (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

/** Upper-cases and strips spaces and dashes, so "abc-123" and "ABC 123" both work. */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

async function newJoinCode(ctx: Pick<MutationCtx, "db">): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const taken = await ctx.db
      .query("properties")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", code))
      .first();
    if (taken === null) return code;
  }
  throw appError("CONFLICT", "Couldn't make a new join code. Please try again.");
}

/** The organisation new properties go into: the first active one, made on first use. */
export async function defaultOrganization(ctx: Pick<MutationCtx, "db">, name = "Livoza"): Promise<Id<"organizations">> {
  const existing = (await ctx.db.query("organizations").collect()).find((o) => o.status === "active");
  if (existing) return existing._id;
  return await ctx.db.insert("organizations", { name, status: "active", createdAt: Date.now() });
}

/** Creates a property with a fresh join code. Shared by the admin screen and the import. */
export async function insertProperty(
  ctx: Pick<MutationCtx, "db">,
  args: { name: string; organizationId?: Id<"organizations"> },
): Promise<Id<"properties">> {
  const now = Date.now();
  return await ctx.db.insert("properties", {
    organizationId: args.organizationId ?? (await defaultOrganization(ctx)),
    name: args.name,
    joinCode: await newJoinCode(ctx),
    joinCodeUpdatedAt: now,
    status: "active",
    createdAt: now,
  });
}

/** Every property with its join code and how many people belong to it. */
export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const properties = await ctx.db.query("properties").collect();
    const rows = [];
    for (const property of properties) {
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .collect();
      const organization = await ctx.db.get(property.organizationId);
      rows.push({
        propertyId: property._id,
        name: property.name,
        organizationName: organization?.name ?? "",
        joinCode: property.joinCode,
        joinCodeUpdatedAt: property.joinCodeUpdatedAt,
        status: property.status,
        memberCount: members.length,
      });
    }
    return rows.sort((a, b) =>
      a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
    );
  },
});

/** Active properties, for pickers. */
export const options = adminQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("properties").withIndex("by_status", (q) => q.eq("status", "active")).collect())
      .map((p) => ({ propertyId: p._id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
});

async function ensureNameFree(ctx: Pick<MutationCtx, "db">, name: string, except?: Id<"properties">) {
  const clash = (await ctx.db.query("properties").collect()).find(
    (p) => p._id !== except && p.status === "active" && p.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw appError("CONFLICT", "A property with this name already exists.");
}

export const create = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = propertyNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    await ensureNameFree(ctx, name.data);
    const propertyId = await insertProperty(ctx, { name: name.data });
    await enqueuePropertySync(ctx, propertyId);
    await logActivity(ctx, { type: "property_added", actor: ctx.admin.user, detail: name.data });
    return propertyId;
  },
});

export const rename = adminMutation({
  args: { propertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (property === null) throw appError("NOT_FOUND");
    const name = propertyNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    if (name.data === property.name) return null;
    await ensureNameFree(ctx, name.data, property._id);
    await ctx.db.patch(property._id, { name: name.data });
    await enqueuePropertySync(ctx, property._id);
    await logActivity(ctx, {
      type: "property_renamed",
      actor: ctx.admin.user,
      detail: `${property.name} → ${name.data}`,
    });
    return null;
  },
});

/** A new join code; the old one stops working at once. People who already joined stay. */
export const changeJoinCode = adminMutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get(propertyId);
    if (property === null || property.status !== "active") throw appError("NOT_FOUND");
    const joinCode = await newJoinCode(ctx);
    await ctx.db.patch(propertyId, { joinCode, joinCodeUpdatedAt: Date.now() });
    await logActivity(ctx, { type: "join_code_changed", actor: ctx.admin.user, detail: property.name });
    return joinCode;
  },
});

/** The open property a join code belongs to, or null. Used by sign-up. */
export const findByJoinCode = internalQuery({
  args: { joinCode: v.string() },
  returns: v.union(v.null(), v.object({ propertyId: v.id("properties"), name: v.string() })),
  handler: async (ctx, { joinCode }) => {
    const code = normalizeJoinCode(joinCode);
    if (code.length !== JOIN_CODE_LENGTH) return null;
    const property = await ctx.db
      .query("properties")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", code))
      .first();
    if (property === null || property.status !== "active") return null;
    return { propertyId: property._id, name: property.name };
  },
});

/** For tests and the owner (dashboard): create a property without the screens. */
export const createInternal = internalMutation({
  args: { name: v.string() },
  returns: v.id("properties"),
  handler: async (ctx, { name }) => {
    const propertyId = await insertProperty(ctx, { name });
    await enqueuePropertySync(ctx, propertyId);
    return propertyId;
  },
});
