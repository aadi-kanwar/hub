import { v, type Infer } from "convex/values";

export const vAdminStatus = v.union(v.literal("active"), v.literal("inactive"));
export type AdminStatus = Infer<typeof vAdminStatus>;

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
);
export type ActivityType = Infer<typeof vActivityType>;
