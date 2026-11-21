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
  // Bed board changes (a bed, a room, the layout or the table).
  v.literal("bed_board_changed"),
);
export type ActivityType = Infer<typeof vActivityType>;

export const vSyncKind = v.union(v.literal("person"), v.literal("property"));

// Bed board (see lib/bedBoard.ts).
export const vTenantStatus = v.union(v.literal("occupied"), v.literal("reserved"), v.literal("notice"));
export const vBedStatus = v.union(v.literal("vacant"), vTenantStatus);
export const vRoomType = v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4));
export const vFieldType = v.union(
  v.literal("text"),
  v.literal("number"),
  v.literal("money"),
  v.literal("date"),
  v.literal("tel"),
  v.literal("select"),
  v.literal("textarea"),
);
export const vBoardFloor = v.object({ n: v.number(), name: v.string() });
export const vBoardRoom = v.object({ no: v.string(), floor: v.number(), type: vRoomType });
export const vBoardField = v.object({
  k: v.string(),
  label: v.string(),
  type: vFieldType,
  on: v.array(vTenantStatus),
  options: v.optional(v.array(v.string())),
  warden: v.boolean(),
});
export const vTenant = v.record(v.string(), v.union(v.string(), v.number()));

