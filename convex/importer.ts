"use node";

import { v } from "convex/values";
import { Scrypt } from "lucia";
import { TOOLS } from "../tools.config";
import { internal } from "./_generated/api";
import { adminAction } from "./lib/functions";
import { buildPlan, passwordHashFor, type HubState, type Plan, type ToolExport } from "./lib/importPlan";
import { callTool, signForTool } from "./lib/ssoSign";
import { vProfileType } from "./lib/validators";

/**
 * One-time import of the people and properties already in the tools.
 *
 * 1. `preview` asks each tool's /sso/export (a request signed by the hub,
 *    audience "<tool>-export") and returns the plan for the admin to check.
 *    Nothing is saved, and password hashes never leave the backend.
 * 2. `apply` asks the tools again (so it uses the latest data) and saves the
 *    plan with the admin's choices. People keep their current password (the
 *    first tool in tools.config.ts order that has one wins). Then every
 *    property and person is sent to the tools, which link their own rows to
 *    the hub's ids.
 *
 * Safe to run again: people already in the hub are left as they are (only
 * linked), and properties already linked stay linked.
 */

type Failed = { toolId: string; name: string; reason: string };
type ApplyResult = {
  ok: boolean;
  failed: Failed[];
  created: number;
  linked: number;
  propertiesCreated: number;
  /** Names of people no tool had a password for: give them a temporary one. */
  needsPassword: string[];
};

async function fetchExports(): Promise<{ exports: ToolExport[]; failed: Failed[] }> {
  const exports: ToolExport[] = [];
  const failed: Failed[] = [];
  await Promise.all(
    TOOLS.map(async (tool) => {
      try {
        const token = await signForTool({}, `${tool.id}-export`, "import");
        const body = await callTool(`${tool.backendUrl}/sso/export`, token);
        exports.push({
          toolId: tool.id,
          properties: Array.isArray(body.properties) ? (body.properties as ToolExport["properties"]) : [],
          people: Array.isArray(body.people) ? (body.people as ToolExport["people"]) : [],
        });
      } catch (error) {
        failed.push({ toolId: tool.id, name: tool.name, reason: error instanceof Error ? error.message : "Failed." });
      }
    }),
  );
  // Keep tools.config.ts order (it decides whose password wins).
  exports.sort((a, b) => TOOLS.findIndex((t) => t.id === a.toolId) - TOOLS.findIndex((t) => t.id === b.toolId));
  return { exports, failed };
}

export const preview = adminAction({
  args: {},
  handler: async (ctx): Promise<Plan & { failed: Failed[] }> => {
    const { exports, failed } = await fetchExports();
    const hub: HubState = await ctx.runQuery(internal.importData.hubState, {});
    return { ...buildPlan(exports, hub), failed };
  },
});

export const apply = adminAction({
  args: {
    /** Per property group: "new", "skip", or a hub property id to merge into. */
    propertyTargets: v.array(v.object({ key: v.string(), target: v.string() })),
    /** The admin's type for people (clashes, or any change). */
    typeChoices: v.array(v.object({ phone: v.string(), type: vProfileType })),
  },
  handler: async (ctx, args): Promise<ApplyResult> => {
    const { exports, failed } = await fetchExports();
    if (failed.length > 0) {
      return { ok: false, failed, created: 0, linked: 0, propertiesCreated: 0, needsPassword: [] };
    }
    const hub: HubState = await ctx.runQuery(internal.importData.hubState, {});
    const plan = buildPlan(exports, hub);
    // Hashes only travel from the tools to the hub's own password store.
    const hashes: { phone: string; hash: string }[] = [];
    const needsPassword: string[] = [];
    for (const person of plan.people) {
      if (person.alreadyInHub) continue;
      const hash = passwordHashFor(exports, person.phone);
      if (hash) hashes.push({ phone: person.phone, hash });
      else {
        // Nobody knows this password; an admin must give them a temporary one.
        const random = crypto.randomUUID() + crypto.randomUUID();
        hashes.push({ phone: person.phone, hash: await new Scrypt().hash(random) });
        needsPassword.push(person.name);
      }
    }
    const result: { created: number; linked: number; propertiesCreated: number } = await ctx.runMutation(internal.importData.save, {
      plan,
      hashes,
      noPassword: plan.people.filter((p) => needsPassword.includes(p.name)).map((p) => p.phone),
      propertyTargets: args.propertyTargets,
      typeChoices: args.typeChoices,
      actorId: ctx.admin.userId,
    });
    return { ok: true, failed, ...result, needsPassword };
  },
});
