import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vActivityType, vAdminStatus, vProfileType, vRecordStatus, vSyncKind } from "./lib/validators";

/**
 * Livoza Hub data model: the one sign-in for everyone. The hub owns people
 * (with one profile type each), organisations, properties and who belongs
 * to which property. Each tool keeps its own copy of the people it needs,
 * kept up to date by sync jobs (convex/sync.ts).
 *
 * Convex has no unique constraints; "one per X" rules are enforced inside
 * the mutation that inserts the row.
 */
export default defineSchema({
  ...authTables,

  // Convex Auth's users table, plus each person's hub details.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()), // E.164: the login identifier (unique)
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** Absent only for a moment while an account is being created. */
    status: v.optional(vAdminStatus),
    /** Absent on rows from before profile types: those are all master admins. */
    profileType: v.optional(vProfileType),
    /** A resident's room, passed to Dine. */
    roomNumber: v.optional(v.string()),
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

  organizations: defineTable({
    name: v.string(),
    status: vRecordStatus,
    createdAt: v.number(),
  }),

  properties: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    /** Residents sign up with it. Unique; stays the same until an admin changes it. */
    joinCode: v.string(),
    joinCodeUpdatedAt: v.number(),
    status: vRecordStatus,
    createdAt: v.number(),
  })
    .index("by_joinCode", ["joinCode"])
    .index("by_status", ["status"]),

  /**
   * Who belongs to which property. A resident has exactly one row; a
   * warden or staff member one or more; a master admin none (they cover
   * every property). One row per user + property.
   */
  memberships: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")), // absent for self sign-up
  })
    .index("by_user", ["userId"])
    .index("by_property", ["propertyId"]),

  /**
   * Changes waiting to be sent to the tools. A job is deleted once the tool
   * confirms; until then a scheduled job retries it. The data sent is never
   * stored: it's rebuilt from the current rows when the job is sent.
   */
  syncJobs: defineTable({
    toolId: v.string(),
    kind: vSyncKind,
    userId: v.optional(v.id("users")),
    propertyId: v.optional(v.id("properties")),
    /** End this person's open tool logins too (type, properties or status changed). */
    revoke: v.boolean(),
    /** Goes up each time a new change joins the job, so a send of older data never deletes it. */
    version: v.number(),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_nextAttemptAt", ["nextAttemptAt"])
    .index("by_user", ["userId"])
    .index("by_tool_user", ["toolId", "userId"])
    .index("by_tool_property", ["toolId", "propertyId"]),

  /**
   * Which of a tool's own property rows a hub property was matched to by the
   * import. Sent with the property, so the tool links that row instead of
   * making a new one. Properties added later need no link.
   */
  toolPropertyLinks: defineTable({
    toolId: v.string(),
    propertyId: v.id("properties"),
    toolPropertyId: v.string(),
  }).index("by_tool_property", ["toolId", "propertyId"]),

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
    /** The person it's about (added, deactivated, reset, type changed...). */
    targetId: v.optional(v.id("users")),
    targetName: v.optional(v.string()),
    /** The number typed at sign-in, or the target's number. */
    phone: v.optional(v.string()),
    toolId: v.optional(v.string()),
    /** Short, plain detail such as "resident → warden" or a property's name. Never secrets. */
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_type_createdAt", ["type", "createdAt"]),
});
