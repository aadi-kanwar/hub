import { v, type Infer } from "convex/values";

export const vAdminStatus = v.union(v.literal("active"), v.literal("inactive"));
export type AdminStatus = Infer<typeof vAdminStatus>;

/**
 * Every person has exactly one profile type. Admin is the master admin.
 * Rows created before profile types existed have none; they were all master
 * admins, so a missing type reads as "admin" (see lib/profiles.ts).
 */
export const PROFILE_TYPES = ["admin", "warden", "staff", "resident"] as const;
export const vProfileType = v.union(
  v.literal("admin"),
  v.literal("warden"),
  v.literal("staff"),
  v.literal("resident"),
);
export type ProfileType = Infer<typeof vProfileType>;

export const vRecordStatus = v.union(v.literal("active"), v.literal("archived"));

export const vActivityType = v.union(
  v.literal("login"),
  v.literal("login_failed"),
  v.literal("tool_launched"),
  v.literal("admin_added"),
  v.literal("admin_reactivated"),
  v.literal("admin_deactivated"),
  v.literal("password_reset"),
  v.literal("password_changed"),
  v.literal("revoked_in_apps"),
  // Everyone's hub (profile types, properties, join codes).
  v.literal("signed_up"),
  v.literal("person_added"),
  v.literal("person_reactivated"),
  v.literal("person_deactivated"),
  v.literal("type_changed"),
  v.literal("properties_changed"),
  v.literal("property_added"),
  v.literal("property_renamed"),
  v.literal("join_code_changed"),
  v.literal("imported_from_tools"),
);
export type ActivityType = Infer<typeof vActivityType>;

export const vSyncKind = v.union(v.literal("person"), v.literal("property"));
