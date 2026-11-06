"use node";

import { importPKCS8, SignJWT } from "jose";
import { v } from "convex/values";
import { findTool, TOOLS } from "../tools.config";
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

/** The hub's signing key, from SSO_PRIVATE_KEY (never logged or returned). */
async function signingKey() {
  const pem = process.env.SSO_PRIVATE_KEY;
  if (!pem) throw appError("SSO_NOT_CONFIGURED");
  try {
    return await importPKCS8(pem.replace(/\\n/g, "\n"), "EdDSA");
  } catch {
    throw appError("SSO_NOT_CONFIGURED");
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
    if (issuer === null) throw appError("SSO_NOT_CONFIGURED");
    const key = await signingKey();
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

/** How long the apps get to answer a revoke request. */
const REVOKE_TIMEOUT_MS = 10_000;

/**
 * "Revoke in all apps" for a deactivated master admin. Sends each tool a
 * one-time request, signed with the hub's key and valid for 60 seconds
 * (audience "<tool id>-revoke"). Each tool then ends the admin's logins that
 * came from the hub and removes the admin role the hub gave them. Returns
 * which tools confirmed; each confirmation is written to the activity log.
 */
export const revokeEverywhere = adminAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ results: { toolId: string; name: string; ok: boolean }[] }> => {
    const target = await ctx.runQuery(internal.admins.revokeTarget, { userId, actorId: ctx.admin.userId });
    const issuer = hubOrigin();
    if (issuer === null) throw appError("SSO_NOT_CONFIGURED");
    const key = await signingKey();

    const results = await Promise.all(
      TOOLS.map(async (tool) => {
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({ phone: target.phone })
          .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
          .setIssuer(issuer)
          .setAudience(`${tool.id}-revoke`)
          .setSubject(userId)
          .setJti(crypto.randomUUID())
          .setIssuedAt(now)
          .setExpirationTime(now + TICKET_LIFETIME_SECONDS)
          .sign(key);
        let ok = false;
        try {
          const response = await fetch(tool.revokeUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
          });
          const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
          ok = response.ok && body?.ok === true;
        } catch {
          ok = false;
        }
        return { toolId: tool.id, name: tool.name, ok };
      }),
    );
    await ctx.runMutation(internal.activity.recordRevoke, {
      actorId: ctx.admin.userId,
      targetId: userId,
      toolIds: results.filter((r) => r.ok).map((r) => r.toolId),
    });
    return { results };
  },
});

