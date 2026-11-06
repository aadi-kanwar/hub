import { formatInTimeZone } from "date-fns-tz";

/** Every time in the hub is shown in India time. */
export const TIMEZONE = "Asia/Kolkata";

/** "24 Oct 2026, 8:14 PM" in India time. */
export function formatDateTime(ms: number): string {
  return formatInTimeZone(new Date(ms), TIMEZONE, "d MMM yyyy, h:mm a");
}

/** "24 Oct 2026" in India time. */
export function formatDate(ms: number): string {
  return formatInTimeZone(new Date(ms), TIMEZONE, "d MMM yyyy");
}
