import { TOOLS, toolRoleFor } from "../../tools.config";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ProfileType } from "./validators";

/**
 * Queues changes for the tools (sent by convex/syncNode.ts). One waiting job
 * per tool + person (or property): a second change before it's sent just
 * joins the waiting one. The job holds no copy of the data; it's read fresh
 * when sent, so the tool always gets the latest.
 */

type Ctx = Pick<MutationCtx, "db" | "scheduler">;

async function kick(ctx: Ctx) {
  await ctx.scheduler.runAfter(0, internal.syncNode.sendDue, {});
}

/**
 * A person changed. Sent to every tool where they have a role now, or had
 * one before (`previousType`), so a tool can also take a role away.
 * `revoke` also ends their open logins in those tools.
 */
export async function enqueuePersonSync(
  ctx: Ctx,
  userId: Id<"users">,
  options: { type: ProfileType; previousType?: ProfileType; revoke: boolean },
) {
  const now = Date.now();
  let queued = false;
  for (const tool of TOOLS) {
    const relevant =
      toolRoleFor(tool, options.type) !== null ||
      (options.previousType !== undefined && toolRoleFor(tool, options.previousType) !== null);
    if (!relevant) continue;
    const waiting = await ctx.db
      .query("syncJobs")
      .withIndex("by_tool_user", (q) => q.eq("toolId", tool.id).eq("userId", userId))
      .first();
    if (waiting !== null) {
      await ctx.db.patch(waiting._id, {
        revoke: waiting.revoke || options.revoke,
        version: waiting.version + 1,
        nextAttemptAt: now,
      });
    } else {
      await ctx.db.insert("syncJobs", {
        toolId: tool.id,
        kind: "person",
        userId,
        revoke: options.revoke,
        version: 0,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    queued = true;
  }
  if (queued) await kick(ctx);
}

/** A property was added or renamed: every tool gets it. */
export async function enqueuePropertySync(ctx: Ctx, propertyId: Id<"properties">) {
  const now = Date.now();
  for (const tool of TOOLS) {
    const waiting = await ctx.db
      .query("syncJobs")
      .withIndex("by_tool_property", (q) => q.eq("toolId", tool.id).eq("propertyId", propertyId))
      .first();
    if (waiting !== null) await ctx.db.patch(waiting._id, { version: waiting.version + 1, nextAttemptAt: now });
    else {
      await ctx.db.insert("syncJobs", {
        toolId: tool.id,
        kind: "property",
        propertyId,
        revoke: false,
        version: 0,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
  }
  await kick(ctx);
}
