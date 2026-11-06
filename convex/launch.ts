"use node";

import { importPKCS8, SignJWT } from "jose";
import { v } from "convex/values";
import { findTool } from "../tools.config";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { adminAction } from "./lib/functions";

/** How long a sign-in ticket is valid. */
export const TICKET_LIFETIME_SECONDS = 60;

/** The hub's own web address (its origin), which tools check as the ticket's issuer. */
export function hubOrigin(): string | null {
  try {
    return new URL(process.env.SITE_URL ?? "").origin;
  } catch {
    return null;
  }
}

/**
 * "Open" on a tool card. Checks that the caller is an active master admin,
 * signs a one-time ticket that's valid for 60 seconds, logs the launch, and
 * returns the address to send the browser to. The ticket goes in the
 * address's #fragment, which browsers never send to any server, so it can't
 * end up in server logs.
 *
 * The signing key comes only from the SSO_PRIVATE_KEY environment variable
 * and is never logged or returned.
 */
export const ticket = adminAction({
  args: { toolId: v.string() },
  handler: async (ctx, { toolId }): Promise<{ url: string }> => {
    const tool = findTool(toolId);
    if (tool === undefined) throw appError("NOT_FOUND", "That tool isn't on the hub.");
    const issuer = hubOrigin();
    const pem = process.env.SSO_PRIVATE_KEY;
    if (!pem || issuer === null) throw appError("SSO_NOT_CONFIGURED");

    let key;
    try {
      key = await importPKCS8(pem.replace(/\\n/g, "\n"), "EdDSA");
    } catch {
      throw appError("SSO_NOT_CONFIGURED");
    }
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      phone: ctx.admin.phone,
      name: ctx.admin.name,
      role: "master_admin",
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(tool.id)
      .setSubject(ctx.admin.userId)
      .setJti(crypto.randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + TICKET_LIFETIME_SECONDS)
      .sign(key);

    // Re-checks the admin is still active in the same step that logs the
    // launch; if they were deactivated a moment ago, no ticket is handed out.
    await ctx.runMutation(internal.activity.recordLaunch, { userId: ctx.admin.userId, toolId: tool.id });
    return { url: `${tool.appUrl}${tool.ssoPath}#ticket=${jwt}` };
  },
});
