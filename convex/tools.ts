import { v } from "convex/values";
import { toolsFor } from "../tools.config";
import { internalQuery, memberQuery } from "./lib/functions";
import { profileTypeOf, propertyIdsOf } from "./lib/profiles";

/** The tool cards this person may open, named for their profile type. */
export const mine = memberQuery({
  args: {},
  handler: async (ctx) => toolsFor(profileTypeOf(ctx.member.user)),
});

/** What a sign-in ticket carries besides who they are. Internal (launch.ts). */
export const ticketDetails = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({
    roomNumber: v.optional(v.string()),
    properties: v.array(v.object({ id: v.string(), name: v.string() })),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const properties = [];
    for (const id of await propertyIdsOf(ctx, userId)) {
      properties.push({ id: id as string, name: (await ctx.db.get(id))?.name ?? "" });
    }
    return { roomNumber: user?.roomNumber, properties };
  },
});
