import {
  CalendarClock,
  CircleDashed,
  LogOut,
  User,
  type LucideIcon,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import {
  bedsOf,
  isIsoDate,
  type BedStatus,
  type Field,
  type Room,
  type RoomType,
  type Tenant,
  type TenantStatus,
} from "@convex/lib/bedBoard";
import { TIMEZONE } from "@/lib/format";

/** The board as the backend sends it. */
export type Board = NonNullable<FunctionReturnType<typeof api.bedBoard.get>>;
export type BedInfo = { status: BedStatus; tenant: Tenant | null };
export type BedMap = Map<string, { status: TenantStatus; tenant: Tenant }>;

export function bedMap(board: Board): BedMap {
  return new Map(
    board.beds.map((b) => [b.bedId, { status: b.status, tenant: b.tenant }]),
  );
}

export function bedInfo(beds: BedMap, id: string): BedInfo {
  return beds.get(id) ?? { status: "vacant", tenant: null };
}

/** Colours and icon for each status; never colour alone (the icon and label go with it). */
export const STATUS_STYLE: Record<
  BedStatus,
  { tile: string; swatch: string; icon: LucideIcon }
> = {
  vacant: {
    tile: "border border-warning-border bg-warning-subtle text-warning",
    swatch: "border border-warning-border bg-warning-subtle",
    icon: CircleDashed,
  },
  occupied: {
    tile: "border border-primary bg-primary text-primary-foreground",
    swatch: "bg-primary",
    icon: User,
  },
  reserved: {
    tile: "border border-info-border bg-info-subtle text-info",
    swatch: "border border-info-border bg-info-subtle",
    icon: CalendarClock,
  },
  notice: {
    tile: "border border-danger-border bg-danger-subtle text-danger-text",
    swatch: "border border-danger-border bg-danger-subtle",
    icon: LogOut,
  },
};

export type Counts = Record<BedStatus, number> & { total: number };

export function countBeds(rooms: readonly Room[], beds: BedMap): Counts {
  const counts: Counts = {
    vacant: 0,
    occupied: 0,
    reserved: 0,
    notice: 0,
    total: 0,
  };
  for (const room of rooms) {
    for (const id of bedsOf(room)) {
      counts[bedInfo(beds, id).status] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

/** The usual rent for a room type on this board (the middle value), or a sensible default. */
export function typicalRent(
  rooms: readonly Room[],
  beds: BedMap,
  type: RoomType,
): number {
  const values: number[] = [];
  for (const room of rooms) {
    if (room.type !== type) continue;
    for (const id of bedsOf(room)) {
      const rent = Number(beds.get(id)?.tenant.rent);
      if (rent > 0) values.push(rent);
    }
  }
  if (values.length === 0)
    return { 1: 16000, 2: 11000, 3: 8500, 4: 7000 }[type];
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

// ---------------------------------------------------------------------------
// Dates and amounts (India time)
// ---------------------------------------------------------------------------

/** Today's date in India, "2026-11-21". */
export function todayIso(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd");
}

/** Days from today to `iso` (negative = in the past). */
export function daysFrom(iso: string): number {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) /
      86_400_000,
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-10-05" → "5 Oct 2026". */
export function formatIso(iso: string, withYear = true): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export function relativeDay(iso: string): string {
  const n = daysFrom(iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** How long someone has stayed since `iso`. */
export function stayLength(iso: string): string {
  const n = -daysFrom(iso);
  if (n < 0) return "not yet";
  if (n < 45) return `${n} days`;
  const months = Math.round(n / 30.4);
  return months < 24
    ? `${months} months`
    : `${(months / 12).toFixed(1).replace(".0", "")} years`;
}

export function formatMoney(value: unknown): string {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    Number.isNaN(Number(value))
  )
    return "—";
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

/** A value as shown in the bed panel (dates and amounts formatted). */
export function displayValue(field: Field, value: string | number): string {
  if (field.type === "money") return formatMoney(value);
  if (field.type === "number")
    return Number.isNaN(Number(value))
      ? String(value)
      : Number(value).toLocaleString("en-IN");
  if (field.type === "date" && typeof value === "string")
    return formatIso(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** True if a bed matches the search text (room/bed, name, phone or work). */
export function matchesSearch(
  id: string,
  tenant: Tenant | null,
  query: string,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const hay =
    `${id} ${tenant?.name ?? ""} ${tenant?.phone ?? ""} ${tenant?.occupation ?? ""}`.toLowerCase();
  return (
    hay.includes(q) || hay.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
  );
}
