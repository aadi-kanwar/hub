/**
 * The bed board: rules shared by the backend (convex/bedBoard.ts) and the
 * website (src/components/beds), so both always agree.
 *
 * Each property has one board: its floors, rooms (1 to 4 beds each, lettered
 * A to D) and the columns kept for each tenant. A bed with nobody assigned is
 * "vacant" and has no stored row; the others are occupied, booked
 * (`reserved`) or on notice.
 *
 * Wardens/managers see their properties' boards read-only, and only the
 * columns marked `warden: true`. The backend removes every other column
 * before anything is sent to them.
 */

export const BED_STATUSES = [
  "vacant",
  "occupied",
  "reserved",
  "notice",
] as const;
export type BedStatus = (typeof BED_STATUSES)[number];
/** Statuses that have a tenant (and a stored row). */
export const TENANT_STATUSES = ["occupied", "reserved", "notice"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const STATUS_LABELS: Record<BedStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  reserved: "Booked",
  notice: "On notice",
};

export const ROOM_TYPES = [1, 2, 3, 4] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  1: "Single",
  2: "Double",
  3: "Triple",
  4: "Four-sharing",
};
export const BED_LETTERS = ["A", "B", "C", "D"] as const;

export type Floor = { n: number; name: string };
export type Room = { no: string; floor: number; type: RoomType };

export const FIELD_TYPES = [
  "text",
  "number",
  "money",
  "date",
  "tel",
  "select",
  "textarea",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Amount (₹)",
  date: "Date",
  tel: "Phone",
  select: "Choice list",
  textarea: "Long text",
};

export type Field = {
  /** Stable key the values are stored under. */
  k: string;
  label: string;
  type: FieldType;
  /** Which statuses use this column. */
  on: TenantStatus[];
  /** Choices, for type "select". */
  options?: string[];
  /** Wardens/managers can see it. */
  warden: boolean;
};

/** A tenant's details: column key → value (text, or a number for amounts). */
export type Tenant = Record<string, string | number>;
export type BedEntry = { status: TenantStatus; tenant: Tenant };

const ALL: TenantStatus[] = ["occupied", "notice", "reserved"];
const CURRENT: TenantStatus[] = ["occupied", "notice"];

/** Who a column is for, as offered in the Columns panel. */
export const SHOW_FOR = {
  all: ALL,
  current: CURRENT,
  bookings: ["reserved"] as TenantStatus[],
} as const;
export type ShowFor = keyof typeof SHOW_FOR;
export const SHOW_FOR_LABELS: Record<ShowFor, string> = {
  all: "Everyone",
  current: "Current tenants only",
  bookings: "Bookings only",
};
export function showForOf(on: readonly TenantStatus[]): ShowFor {
  if (on.length === 1 && on[0] === "reserved") return "bookings";
  if (!on.includes("reserved")) return "current";
  return "all";
}

/**
 * The columns a new board starts with. Wardens see who is where, contact
 * details, dates and notes; never money or ID proof.
 */
export const DEFAULT_FIELDS: Field[] = [
  { k: "name", label: "Full name", type: "text", on: ALL, warden: true },
  { k: "phone", label: "Phone", type: "tel", on: ALL, warden: true },
  {
    k: "occupation",
    label: "Work or college",
    type: "text",
    on: ALL,
    warden: true,
  },
  {
    k: "moveIn",
    label: "Move-in date",
    type: "date",
    on: ["reserved"],
    warden: true,
  },
  {
    k: "advance",
    label: "Booking advance",
    type: "money",
    on: ["reserved"],
    warden: false,
  },
  {
    k: "checkIn",
    label: "Checked in on",
    type: "date",
    on: CURRENT,
    warden: true,
  },
  {
    k: "moveOut",
    label: "Moving out on",
    type: "date",
    on: ["notice"],
    warden: true,
  },
  { k: "rent", label: "Monthly rent", type: "money", on: ALL, warden: false },
  { k: "deposit", label: "Deposit", type: "money", on: CURRENT, warden: false },
  {
    k: "rentStatus",
    label: "This month's rent",
    type: "select",
    options: ["Paid", "Due", "Partly paid"],
    on: CURRENT,
    warden: false,
  },
  { k: "idProof", label: "ID proof", type: "text", on: CURRENT, warden: false },
  {
    k: "emergency",
    label: "Emergency contact",
    type: "text",
    on: CURRENT,
    warden: true,
  },
  { k: "notes", label: "Notes", type: "textarea", on: ALL, warden: true },
];

/**
 * Columns bookings and the board itself depend on: they can be renamed but
 * not removed, and their type, statuses and warden visibility are fixed.
 */
export const CORE_FIELDS: Record<
  string,
  { type: FieldType; on: TenantStatus[]; warden: boolean }
> = {
  name: { type: "text", on: ALL, warden: true },
  checkIn: { type: "date", on: CURRENT, warden: true },
  moveIn: { type: "date", on: ["reserved"], warden: true },
  moveOut: { type: "date", on: ["notice"], warden: true },
};

/** The rooms of the earlier bed board page (Floors 2 to 5), offered when a property's board is set up. */
export const STARTER_LAYOUT: { floors: Floor[]; rooms: Room[] } = (() => {
  const plan: Record<number, RoomType[]> = {
    2: [2, 2, 3, 2, 2, 2, 2, 2],
    3: [2, 3, 2, 1, 2, 2, 3, 2, 1, 2, 3, 2, 2, 1, 3],
    4: [3, 2, 2, 1, 2, 3, 2, 2, 1, 3, 2, 2, 1, 2, 3],
    5: [1, 2, 2, 3, 2, 1, 2, 3],
  };
  const floors: Floor[] = [];
  const rooms: Room[] = [];
  for (const [floor, types] of Object.entries(plan)) {
    const n = Number(floor);
    floors.push({ n, name: `Floor ${n}` });
    types.forEach((type, i) =>
      rooms.push({ no: String(n * 100 + i + 1), floor: n, type }),
    );
  }
  return { floors, rooms };
})();

export const LIMITS = {
  floors: 50,
  rooms: 600,
  fields: 40,
  options: 30,
  label: 60,
  option: 40,
  roomNo: 12,
  floorName: 40,
  text: 300,
  longText: 2000,
};

// ---------------------------------------------------------------------------
// Beds and rooms
// ---------------------------------------------------------------------------

export const bedId = (roomNo: string, letter: string) => `${roomNo}-${letter}`;

export function bedsOf(room: Pick<Room, "no" | "type">): string[] {
  return BED_LETTERS.slice(0, room.type).map((letter) =>
    bedId(room.no, letter),
  );
}

export function splitBedId(id: string): { roomNo: string; letter: string } {
  const at = id.lastIndexOf("-");
  return { roomNo: id.slice(0, at), letter: id.slice(at + 1) };
}

/** Sorts rooms like 101, 102, 110 (numbers in order, not as text). */
export function byRoomNo(a: Pick<Room, "no">, b: Pick<Room, "no">): number {
  return a.no.localeCompare(b.no, undefined, { numeric: true });
}

export function roomNoProblem(no: string): string | null {
  if (no.length === 0) return "Give this room a number.";
  if (/[\s-]/.test(no)) return "No spaces or dashes in room numbers.";
  if (no.length > LIMITS.roomNo) return `At most ${LIMITS.roomNo} characters.`;
  return null;
}

// ---------------------------------------------------------------------------
// Tenant values
// ---------------------------------------------------------------------------

/** "₹ 12,000" / "Rs. 12000" → "12000". */
export function cleanNumber(value: string): string {
  return value.replace(/^\s*(rs\.?|inr)\s*/i, "").replace(/[₹,\s]/g, "");
}

export const isIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

const isEmpty = (v: unknown) =>
  v === undefined || v === null || String(v).trim() === "";

/** Problems with a tenant's details for `status`, by column key (empty when fine). */
export function tenantProblems(
  status: TenantStatus,
  tenant: Tenant,
  fields: readonly Field[],
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of fields) {
    if (!field.on.includes(status)) continue;
    const raw = tenant[field.k];
    if (isEmpty(raw)) {
      if (field.k === "name") problems.name = "Add the tenant's name.";
      if (field.k === "moveOut" && status === "notice")
        problems.moveOut = "Add the date they're moving out.";
      if (field.k === "moveIn" && status === "reserved")
        problems.moveIn = "Add the move-in date.";
      continue;
    }
    const value = String(raw).trim();
    const max = field.type === "textarea" ? LIMITS.longText : LIMITS.text;
    if (value.length > max) problems[field.k] = `At most ${max} characters.`;
    else if (field.type === "date" && !isIsoDate(value))
      problems[field.k] = "Use a date, like 05-10-2026.";
    else if (
      (field.type === "money" || field.type === "number") &&
      Number.isNaN(Number(cleanNumber(value)))
    )
      problems[field.k] = "Use a number.";
    else if (
      field.type === "select" &&
      (field.options ?? []).length > 0 &&
      !(field.options ?? []).includes(value)
    )
      problems[field.k] = `Pick one of: ${(field.options ?? []).join(", ")}.`;
  }
  return problems;
}

/** Only the columns `status` uses, without empty ones; amounts become numbers. */
export function cleanTenant(
  status: TenantStatus,
  tenant: Tenant,
  fields: readonly Field[],
): Tenant {
  const kept: Tenant = {};
  for (const field of fields) {
    if (!field.on.includes(status)) continue;
    const raw = tenant[field.k];
    if (isEmpty(raw)) continue;
    const value = String(raw).trim();
    if (field.type === "money" || field.type === "number") {
      const n = Number(cleanNumber(value));
      kept[field.k] = Number.isNaN(n) ? value : n;
    } else kept[field.k] = value;
  }
  return kept;
}

/** Only what wardens may see. */
export function wardenView(tenant: Tenant, fields: readonly Field[]): Tenant {
  const kept: Tenant = {};
  for (const field of fields)
    if (field.warden && tenant[field.k] !== undefined)
      kept[field.k] = tenant[field.k];
  return kept;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** What's wrong with a set of columns, or null. */
export function fieldsProblem(fields: readonly Field[]): string | null {
  if (fields.length > LIMITS.fields) return `At most ${LIMITS.fields} columns.`;
  const keys = new Set<string>();
  for (const field of fields) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(field.k))
      return "A column has an invalid key.";
    if (keys.has(field.k)) return "Two columns have the same key.";
    keys.add(field.k);
    const label = field.label.trim();
    if (label.length === 0) return "Every column needs a name.";
    if (label.length > LIMITS.label)
      return `Column names can be at most ${LIMITS.label} characters.`;
    if (!FIELD_TYPES.includes(field.type)) return `${label}: unknown type.`;
    if (
      field.on.length === 0 ||
      field.on.some((s) => !TENANT_STATUSES.includes(s))
    )
      return `${label}: choose who it's for.`;
    if (field.type === "select") {
      const options = field.options ?? [];
      if (options.length === 0) return `${label}: add at least one choice.`;
      if (options.length > LIMITS.options)
        return `${label}: at most ${LIMITS.options} choices.`;
      if (
        options.some((o) => o.trim().length === 0 || o.length > LIMITS.option)
      )
        return `${label}: choices must be 1 to ${LIMITS.option} characters.`;
    }
    const core = CORE_FIELDS[field.k];
    if (
      core &&
      (core.type !== field.type ||
        core.warden !== field.warden ||
        core.on.join() !== field.on.join())
    )
      return `${label} is needed by the board; it can be renamed but not otherwise changed.`;
  }
  for (const k of Object.keys(CORE_FIELDS))
    if (!keys.has(k)) return "The board's required columns can't be removed.";
  return null;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type LayoutRoom = Room & {
  /** The room's number before this edit (absent for a new room). */ orig?: string;
};

/**
 * Problems with an edited layout, by index in `rooms` (empty when fine).
 * `takenLetters(origNo)` gives the letters of a room's beds that have someone assigned.
 */
export function layoutProblems(
  floors: readonly Floor[],
  rooms: readonly LayoutRoom[],
  takenLetters: (origNo: string) => string[],
): Record<number, string[]> {
  const problems: Record<number, string[]> = {};
  const add = (i: number, message: string) => {
    problems[i] = [...(problems[i] ?? []), message];
  };
  const seen = new Map<string, number>();
  const floorNumbers = new Set(floors.map((f) => f.n));
  rooms.forEach((room, i) => {
    const no = room.no.trim();
    const problem = roomNoProblem(no);
    if (problem) add(i, problem);
    else if (seen.has(no.toLowerCase())) {
      add(i, `Room ${no} is listed twice.`);
      add(seen.get(no.toLowerCase())!, `Room ${no} is listed twice.`);
    } else seen.set(no.toLowerCase(), i);
    if (!floorNumbers.has(room.floor)) add(i, "Pick a floor.");
    if (!ROOM_TYPES.includes(room.type)) add(i, "Pick how many beds.");
    if (room.orig !== undefined) {
      const lost = takenLetters(room.orig).filter(
        (l) =>
          BED_LETTERS.indexOf(l as (typeof BED_LETTERS)[number]) >= room.type,
      );
      if (lost.length > 0)
        add(i, `Bed ${lost.join(" and ")} has someone assigned. Vacate first.`);
    }
  });
  return problems;
}

export function floorsProblem(floors: readonly Floor[]): string | null {
  if (floors.length === 0) return "Keep at least one floor.";
  if (floors.length > LIMITS.floors) return `At most ${LIMITS.floors} floors.`;
  const numbers = new Set<number>();
  for (const floor of floors) {
    if (!Number.isInteger(floor.n) || floor.n < -5 || floor.n > 500)
      return "A floor has an invalid number.";
    if (numbers.has(floor.n)) return "Two floors have the same number.";
    numbers.add(floor.n);
    if (floor.name.trim().length === 0 || floor.name.length > LIMITS.floorName)
      return `Floor names must be 1 to ${LIMITS.floorName} characters.`;
  }
  return null;
}
