import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { insertProperty } from "./properties";
import { logActivity } from "./lib/activity";
import { internalMutation, internalQuery } from "./lib/functions";
import type { HubState, Plan } from "./lib/importPlan";
import { profileTypeOf } from "./lib/profiles";
import { enqueuePersonSync, enqueuePropertySync } from "./lib/syncQueue";
import { vProfileType, type ProfileType } from "./lib/validators";

/** The database side of convex/importer.ts. Internal only. */

export const hubState = internalQuery({
  args: {},
  handler: async (ctx): Promise<HubState> => {
    const properties = (await ctx.db.query("properties").collect())
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p._id as string, name: p.name }));
    const people = (await ctx.db.query("users").collect())
      .filter((u) => u.phone && u.status !== undefined)
      .map((u) => ({ phone: u.phone!, userId: u._id as string, type: profileTypeOf(u) }));
    return { properties, people };
  },
});

export const save = internalMutation({
  args: {
    plan: v.any(),
    hashes: v.array(v.object({ phone: v.string(), hash: v.string() })),
    noPassword: v.array(v.string()),
    propertyTargets: v.array(v.object({ key: v.string(), target: v.string() })),
    typeChoices: v.array(v.object({ phone: v.string(), type: vProfileType })),
    actorId: v.id("users"),
  },
  returns: v.object({ created: v.number(), linked: v.number(), propertiesCreated: v.number() }),
  handler: async (ctx, args) => {
    const plan = args.plan as Plan;
    const now = Date.now();

    // 1. Properties: merge, make new, or skip; remember each tool row's link.
    const targets = new Map(args.propertyTargets.map((t) => [t.key, t.target]));
    const hubIdOfKey = new Map<string, Id<"properties">>();
    let propertiesCreated = 0;
    for (const group of plan.properties) {
      const target = targets.get(group.key) ?? (group.hubPropertyId ?? "new");
      if (target === "skip") continue;
      let propertyId: Id<"properties">;
      if (target === "new") {
        propertyId = await insertProperty(ctx, { name: group.name });
        propertiesCreated += 1;
      } else {
        const existing = await ctx.db.get(target as Id<"properties">);
        if (existing === null) continue;
        propertyId = existing._id;
      }
      hubIdOfKey.set(group.key, propertyId);
      for (const row of group.tools) {
        const link = await ctx.db
          .query("toolPropertyLinks")
          .withIndex("by_tool_property", (q) => q.eq("toolId", row.toolId).eq("propertyId", propertyId))
          .first();
        if (link === null) {
          await ctx.db.insert("toolPropertyLinks", { toolId: row.toolId, propertyId, toolPropertyId: row.toolPropertyId });
        }
      }
      await enqueuePropertySync(ctx, propertyId);
    }

    // 2. People.
    const typeOf = new Map(args.typeChoices.map((c) => [c.phone, c.type]));
    const hashOf = new Map(args.hashes.map((h) => [h.phone, h.hash]));
    const noPassword = new Set(args.noPassword);
    let created = 0;
    let linked = 0;
    for (const person of plan.people) {
      const existing = await ctx.db
        .query("users")
        .withIndex("phone", (q) => q.eq("phone", person.phone))
        .first();
      if (existing !== null && existing.status !== undefined) {
        // Already in the hub: the hub's details win. The tools just get linked.
        await enqueuePersonSync(ctx, existing._id, { type: profileTypeOf(existing), revoke: false });
        linked += 1;
        continue;
      }
      const hash = hashOf.get(person.phone);
      if (hash === undefined) continue;
      const type: ProfileType = typeOf.get(person.phone) ?? person.type;
      let propertyIds = [
        ...new Set(person.propertyKeys.map((k) => hubIdOfKey.get(k)).filter((id): id is Id<"properties"> => !!id)),
      ];
      if (type === "admin") propertyIds = [];
      if (type === "resident") propertyIds = propertyIds.slice(0, 1);

      const userId = await ctx.db.insert("users", {
        phone: person.phone,
        name: person.name,
        status: "active",
        profileType: type,
        roomNumber: type === "resident" ? (person.roomNumber ?? undefined) : undefined,
        mustChangePassword: noPassword.has(person.phone) ? true : undefined,
        createdAt: now,
        createdBy: args.actorId,
      });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: PHONE_PASSWORD_PROVIDER,
        providerAccountId: person.phone,
        secret: hash,
      });
      for (const propertyId of propertyIds) {
        await ctx.db.insert("memberships", { userId, propertyId, createdAt: now, createdBy: args.actorId });
      }
      await enqueuePersonSync(ctx, userId, { type, revoke: false });
      created += 1;
    }

    await logActivity(ctx, {
      type: "imported_from_tools",
      actor: await ctx.db.get(args.actorId),
      detail: `${created} people added, ${linked} linked, ${propertiesCreated} properties added`,
    });
    return { created, linked, propertiesCreated };
  },
});
