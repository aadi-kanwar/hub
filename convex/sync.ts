import { v } from "convex/values";
import { findTool, toolRoleFor } from "../tools.config";
import { internal } from "./_generated/api";
import { adminMutation, adminQuery, internalMutation, internalQuery } from "./lib/functions";
import { profileTypeOf, propertyIdsOf } from "./lib/profiles";

/**
 * Sync jobs (queued by lib/syncQueue.ts, sent by syncNode.ts). The data sent
 * is built here, fresh from the current rows, at the moment it's sent.
 *
 * What a tool receives (inside a JWT the hub signs, audience "<tool>-sync"):
 *
 *   person:   { kind: "person", hubUserId, phone, name, profileType,
 *               role (the tool's role, or null = no access), active,
 *               revoke (end their open logins), roomNumber?,
 *               properties: "*" (all) | [{ id, name }] }
 *   property: { kind: "property", property: { id, name, organizationName,
 *               active }, toolPropertyId? (the tool's own row to link) }
 */

/** Retry waits: 1, 2, 4 ... minutes, at most 6 hours. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
}

export const due = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) =>
    (
      await ctx.db
        .query("syncJobs")
        .withIndex("by_nextAttemptAt", (q) => q.lte("nextAttemptAt", Date.now()))
        .take(limit)
    ).map((job) => job._id),
});

/** The job's data to send now, or null if it no longer exists (or has nothing to send). */
export const payload = internalQuery({
  args: { jobId: v.id("syncJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job === null) return null;
    const tool = findTool(job.toolId);
    if (tool === undefined) return null;

    if (job.kind === "property") {
      const property = job.propertyId ? await ctx.db.get(job.propertyId) : null;
      if (property === null) return null;
      const organization = await ctx.db.get(property.organizationId);
      const link = await ctx.db
        .query("toolPropertyLinks")
        .withIndex("by_tool_property", (q) => q.eq("toolId", tool.id).eq("propertyId", property._id))
        .first();
      return {
        toolId: tool.id,
        version: job.version,
        claims: {
          kind: "property" as const,
          property: {
            id: property._id as string,
            name: property.name,
            organizationName: organization?.name ?? "",
            active: property.status === "active",
          },
          toolPropertyId: link?.toolPropertyId,
        },
      };
    }

    const user = job.userId ? await ctx.db.get(job.userId) : null;
    if (user === null || !user.phone) return null;
    const type = profileTypeOf(user);
    const propertyIds = await propertyIdsOf(ctx, user._id);
    const properties = [];
    for (const id of propertyIds) properties.push({ id: id as string, name: (await ctx.db.get(id))?.name ?? "" });
    return {
      toolId: tool.id,
      version: job.version,
      claims: {
        kind: "person" as const,
        hubUserId: user._id as string,
        phone: user.phone,
        name: user.name ?? "",
        profileType: type,
        role: toolRoleFor(tool, type),
        active: user.status === "active",
        revoke: job.revoke,
        roomNumber: user.roomNumber,
        properties: type === "admin" ? ("*" as const) : properties,
      },
    };
  },
});

/** After a send: done (delete, unless a newer change joined meanwhile) or try again later. */
export const finish = internalMutation({
  args: { jobId: v.id("syncJobs"), version: v.number(), ok: v.boolean(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { jobId, version, ok, error }) => {
    const job = await ctx.db.get(jobId);
    if (job === null) return null;
    if (ok) {
      if (job.version === version) await ctx.db.delete(jobId);
      return null;
    }
    const attempts = job.attempts + 1;
    await ctx.db.patch(jobId, {
      attempts,
      nextAttemptAt: Date.now() + retryDelayMs(attempts),
      lastError: error?.slice(0, 200),
    });
    return null;
  },
});

/** A job whose person or property is gone has nothing to send. */
export const drop = internalMutation({
  args: { jobId: v.id("syncJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    if ((await ctx.db.get(jobId)) !== null) await ctx.db.delete(jobId);
    return null;
  },
});

/** For the admin screens: how many changes are still waiting per tool, and how many keep failing. */
export const status = adminQuery({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query("syncJobs").collect();
    const byTool = new Map<string, { waiting: number; failing: number; lastError: string | null }>();
    for (const job of jobs) {
      const row = byTool.get(job.toolId) ?? { waiting: 0, failing: 0, lastError: null };
      row.waiting += 1;
      if (job.attempts > 0) {
        row.failing += 1;
        row.lastError = job.lastError ?? row.lastError;
      }
      byTool.set(job.toolId, row);
    }
    return [...byTool.entries()].map(([toolId, row]) => ({ toolId, ...row }));
  },
});

/** "Try now" on a tool that's failing: makes all its waiting jobs due at once. */
export const retryNow = adminMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const job of await ctx.db.query("syncJobs").collect()) {
      if (job.nextAttemptAt > now) await ctx.db.patch(job._id, { nextAttemptAt: now });
    }
    await ctx.scheduler.runAfter(0, internal.syncNode.sendDue, {});
    return null;
  },
});
