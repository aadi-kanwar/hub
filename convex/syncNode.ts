"use node";

import { v } from "convex/values";
import { findTool } from "../tools.config";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./lib/functions";
import { callTool, signForTool } from "./lib/ssoSign";

/** How many jobs one run sends; the rest wait for the next run (every minute). */
const BATCH = 50;

/**
 * Sends the sync jobs that are due to their tools' /sso/sync. Runs right
 * after a change is queued, and every minute (convex/crons.ts) for retries.
 * Sending the same data twice is harmless: the tools apply it as "make it so".
 */
export const sendDue = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const jobIds: Id<"syncJobs">[] = await ctx.runQuery(internal.sync.due, { limit: BATCH });
    await Promise.all(
      jobIds.map(async (jobId) => {
        const data = await ctx.runQuery(internal.sync.payload, { jobId });
        if (data === null) {
          await ctx.runMutation(internal.sync.drop, { jobId });
          return;
        }
        const tool = findTool(data.toolId)!;
        try {
          const subject = data.claims.kind === "person" ? data.claims.hubUserId : data.claims.property.id;
          const token = await signForTool(data.claims, `${tool.id}-sync`, subject);
          await callTool(`${tool.backendUrl}/sso/sync`, token);
          await ctx.runMutation(internal.sync.finish, { jobId, version: data.version, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed.";
          await ctx.runMutation(internal.sync.finish, { jobId, version: data.version, ok: false, error: message });
        }
      }),
    );
    return null;
  },
});
