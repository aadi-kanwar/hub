import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vActivityType, vAdminStatus } from "./lib/validators";

/**
 * Admin Hub data model. Every account here is a master admin: there are no
 * other roles. Convex has no unique constraints; "one per X" rules are
 * enforced inside the mutation that inserts the row.
 */
export default defineSchema({
  ...authTables,

  // Convex Auth's users table, plus the master admin's details.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()), // E.164: the login identifier (unique)
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** Absent only on rows Convex Auth creates itself (never happens: there is no sign-up). */
    status: v.optional(vAdminStatus),
    /** Set when the account was created or its password reset; cleared once they choose their own. */
    mustChangePassword: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    createdBy: v.optional(v.id("users")), // absent for the seeded first admin
    deactivatedAt: v.optional(v.number()),
    deactivatedBy: v.optional(v.id("users")),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_status", ["status"]),

  // Failed sign-in attempts per phone number (registered or not), and the
  // 15-minute lock after too many.
  authAttemptLimits: defineTable({
    key: v.string(), // "fail:+919876543210"
    windowStart: v.number(), // when the first failure of the current count happened
    count: v.number(),
    lockedUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // Append-only: sign-ins, failed sign-ins, tool launches and admin changes.
  // Never store passwords, tickets or keys here.
  activityLog: defineTable({
    type: vActivityType,
    /** Who did it (absent for failed sign-ins and the seed script). */
    actorId: v.optional(v.id("users")),
    actorName: v.optional(v.string()),
    /** The admin it's about (added, deactivated, reset). */
    targetId: v.optional(v.id("users")),
    targetName: v.optional(v.string()),
    /** The number typed at sign-in, or the target's number. */
    phone: v.optional(v.string()),
    toolId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_type_createdAt", ["type", "createdAt"]),
});
