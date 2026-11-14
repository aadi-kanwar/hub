"use node";

import { v } from "convex/values";
import { findTool, toolRoleFor } from "../tools.config";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { memberAction } from "./lib/functions";
import { signForTool } from "./lib/ssoSign";

/**
 * "Open" on a tool card. Checks the caller is active and the tool gives
 * their profile type a role, signs a one-time ticket valid for 60 seconds,
 * logs the launch, and returns the address to send the browser to. The
 * ticket goes in the address's #fragment, which browsers never send to any
 * server, so it can't end up in server logs.
 *
 * Ticket claims (audience = the tool id, subject = the hub user id):
 *   phone, name, profileType, role (the tool's role), roomNumber?,
 *   properties: "*" for admins (every property), else [{ id, name }] with
 *   the hub's property ids.
 */
export const ticket = memberAction({
  args: { toolId: v.string() },
  handler: async (ctx, { toolId }): Promise<{ url: string }> => {
    const tool = findTool(toolId);
    if (tool === undefined) throw appError("NOT_FOUND", "That tool isn't on the hub.");
    const role = toolRoleFor(tool, ctx.member.profileType);
    if (role === null) throw appError("NO_ACCESS");
    const details = await ctx.runQuery(internal.tools.ticketDetails, { userId: ctx.member.userId });
    const jwt = await signForTool(
      {
        phone: ctx.member.phone,
        name: ctx.member.name,
        profileType: ctx.member.profileType,
        role,
        roomNumber: details.roomNumber,
        properties: ctx.member.profileType === "admin" ? "*" : details.properties,
      },
      tool.id,
      ctx.member.userId,
    );
    // Re-checks the person is still active in the same step that logs the
    // launch; if they were deactivated a moment ago, no ticket is handed out.
    await ctx.runMutation(internal.activity.recordLaunch, { userId: ctx.member.userId, toolId: tool.id });
    return { url: `${tool.appUrl}${tool.ssoPath}#ticket=${jwt}` };
  },
});
