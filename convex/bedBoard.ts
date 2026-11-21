import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import {
  bedId as makeBedId,
  bedsOf,
  cleanTenant,
  DEFAULT_FIELDS,
  fieldsProblem,
  floorsProblem,
  layoutProblems,
  LIMITS,
  roomNoProblem,
  ROOM_TYPE_LABELS,
  splitBedId,
  STARTER_LAYOUT,
  tenantProblems,
  wardenView,
  type Field,
  type TenantStatus,
} from "./lib/bedBoard";
import { appError } from "./lib/errors";
import {
  adminMutation,
  memberQuery,
  type SignedInViewer,
} from "./lib/functions";
import { profileTypeOf, propertyIdsOf } from "./lib/profiles";
import {
  vBedStatus,
  vBoardField,
  vBoardFloor,
  vRoomType,
  vTenant,
  vTenantStatus,
} from "./lib/validators";

/**
 * The bed board: one per property. Master admins see and change everything.
 * Wardens/managers see the boards of their own properties, read-only, with
 * only the columns marked for wardens (lib/bedBoard.ts wardenView): money and
 * ID proof never leave the backend for them. Staff and residents have no
 * access. Every change is written to the activity log.
 */

type ReadCtx = Pick<QueryCtx, "db">;

/** Admins: every active property. Wardens: their own. Others: none (refused). */
async function readableProperties(
  ctx: ReadCtx,
  viewer: SignedInViewer,
): Promise<Doc<"properties">[]> {
  const type = profileTypeOf(viewer.user);
  if (type === "admin") {
    return await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
  }
  if (type !== "warden") throw appError("FORBIDDEN");
  const ids = await propertyIdsOf(ctx, viewer.userId);
  const properties = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return properties.filter(
    (p): p is Doc<"properties"> => p !== null && p.status === "active",
  );
}

async function requireReader(
  ctx: ReadCtx,
  viewer: SignedInViewer,
  propertyId: Id<"properties">,
) {
  const allowed = await readableProperties(ctx, viewer);
  const property = allowed.find((p) => p._id === propertyId);
  if (property === undefined)
    throw appError("NOT_FOUND", "That property's bed board wasn't found.");
  return { property, canEdit: profileTypeOf(viewer.user) === "admin" };
}

async function boardOf(ctx: ReadCtx, propertyId: Id<"properties">) {
  return await ctx.db
    .query("bedBoards")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .unique();
}

async function entriesOf(ctx: ReadCtx, propertyId: Id<"properties">) {
  return await ctx.db
    .query("bedEntries")
    .withIndex("by_property_bed", (q) => q.eq("propertyId", propertyId))
    .collect();
}

async function entryOf(
  ctx: ReadCtx,
  propertyId: Id<"properties">,
  bedId: string,
) {
  return await ctx.db
    .query("bedEntries")
    .withIndex("by_property_bed", (q) =>
      q.eq("propertyId", propertyId).eq("bedId", bedId),
    )
    .unique();
}

/** An active property and its board, for a change (admins only, checked by the wrapper). */
async function editableBoard(ctx: MutationCtx, propertyId: Id<"properties">) {
  const property = await ctx.db.get(propertyId);
  if (property === null || property.status !== "active")
    throw appError("NOT_FOUND", "That property wasn't found.");
  const board = await boardOf(ctx, propertyId);
  if (board === null)
    throw appError("NOT_FOUND", "This property has no bed board yet.");
  return { property, board };
}

/** Marks the board changed (its version goes up) and logs what happened. */
async function recordChange(
  ctx: MutationCtx,
  admin: SignedInViewer,
  property: Doc<"properties">,
  board: Doc<"bedBoards">,
  detail: string,
  patch: Partial<Pick<Doc<"bedBoards">, "floors" | "rooms" | "fields">> = {},
) {
  await ctx.db.patch(board._id, {
    ...patch,
    version: board.version + 1,
    updatedAt: Date.now(),
    updatedBy: admin.userId,
  });
  await logActivity(ctx, {
    type: "bed_board_changed",
    actor: admin.user,
    detail: `${property.name}: ${detail}`,
  });
}

const bedLabel = (id: string) => {
  const { roomNo, letter } = splitBedId(id);
  return `room ${roomNo} bed ${letter}`;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The properties whose bed board the caller may open, and whether they may change it. */
export const places = memberQuery({
  args: {},
  handler: async (ctx) => {
    const properties = await readableProperties(ctx, ctx.member);
    const rows = await Promise.all(
      properties.map(async (p) => ({
        propertyId: p._id,
        name: p.name,
        hasBoard: (await boardOf(ctx, p._id)) !== null,
      })),
    );
    return {
      canEdit: profileTypeOf(ctx.member.user) === "admin",
      properties: rows.sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/**
 * One property's board, or null if it hasn't been set up. For wardens, the
 * columns and tenant details are cut down to what they may see.
 */
export const get = memberQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const { property, canEdit } = await requireReader(
      ctx,
      ctx.member,
      propertyId,
    );
    const board = await boardOf(ctx, propertyId);
    if (board === null) return null;
    const entries = await entriesOf(ctx, propertyId);
    const fields = canEdit
      ? board.fields
      : board.fields.filter((f) => f.warden);
    return {
      propertyName: property.name,
      canEdit,
      version: board.version,
      updatedAt: board.updatedAt,
      floors: board.floors,
      rooms: board.rooms,
      fields,
      beds: entries.map((e) => ({
        bedId: e.bedId,
        status: e.status,
        tenant: canEdit ? e.tenant : wardenView(e.tenant, board.fields),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Changing (master admins only)
// ---------------------------------------------------------------------------

/** Sets up a property's board: the earlier bed board's rooms, or one empty floor. */
export const create = adminMutation({
  args: {
    propertyId: v.id("properties"),
    start: v.union(v.literal("starter"), v.literal("empty")),
  },
  handler: async (ctx, { propertyId, start }) => {
    const property = await ctx.db.get(propertyId);
    if (property === null || property.status !== "active")
      throw appError("NOT_FOUND", "That property wasn't found.");
    if ((await boardOf(ctx, propertyId)) !== null)
      throw appError("CONFLICT", "This property already has a bed board.");
    const layout =
      start === "starter"
        ? STARTER_LAYOUT
        : { floors: [{ n: 1, name: "Floor 1" }], rooms: [] };
    await ctx.db.insert("bedBoards", {
      propertyId,
      floors: layout.floors,
      rooms: layout.rooms,
      fields: DEFAULT_FIELDS,
      version: 1,
      updatedAt: Date.now(),
      updatedBy: ctx.admin.userId,
    });
    await logActivity(ctx, {
      type: "bed_board_changed",
      actor: ctx.admin.user,
      detail: `${property.name}: bed board set up (${layout.rooms.length} rooms)`,
    });
    return null;
  },
});

function verbFor(
  before: TenantStatus | "vacant",
  after: TenantStatus | "vacant",
): string {
  if (after === "vacant")
    return before === "reserved" ? "booking cancelled" : "marked vacant";
  if (before === after) return "details updated";
  if (after === "reserved") return "booked";
  if (after === "notice") return "notice recorded";
  if (before === "notice") return "notice withdrawn";
  return "checked in";
}

/** Saves one bed: its status and tenant details ("vacant" removes the tenant). */
export const saveBed = adminMutation({
  args: {
    propertyId: v.id("properties"),
    bedId: v.string(),
    status: vBedStatus,
    tenant: vTenant,
  },
  handler: async (ctx, { propertyId, bedId, status, tenant }) => {
    const { property, board } = await editableBoard(ctx, propertyId);
    const { roomNo } = splitBedId(bedId);
    const room = board.rooms.find((r) => r.no === roomNo);
    if (room === undefined || !bedsOf(room).includes(bedId))
      throw appError("NOT_FOUND", "That bed isn't on the board.");
    const existing = await entryOf(ctx, propertyId, bedId);
    const before = existing?.status ?? "vacant";
    if (status === "vacant") {
      if (existing === null) return null;
      await ctx.db.delete(existing._id);
    } else {
      const problems = Object.values(
        tenantProblems(status, tenant, board.fields),
      );
      if (problems.length > 0) throw appError("INVALID_INPUT", problems[0]);
      const row = {
        status,
        tenant: cleanTenant(status, tenant, board.fields),
        updatedAt: Date.now(),
        updatedBy: ctx.admin.userId,
      };
      if (existing === null)
        await ctx.db.insert("bedEntries", { propertyId, bedId, ...row });
      else await ctx.db.patch(existing._id, row);
    }
    await recordChange(
      ctx,
      ctx.admin,
      property,
      board,
      `${bedLabel(bedId)} ${verbFor(before, status)}`,
    );
    return null;
  },
});

/** Changes one room's number, floor or number of beds. Tenants stay with their beds. */
export const saveRoom = adminMutation({
  args: {
    propertyId: v.id("properties"),
    oldNo: v.string(),
    no: v.string(),
    floor: v.number(),
    type: vRoomType,
  },
  handler: async (ctx, { propertyId, oldNo, no: rawNo, floor, type }) => {
    const { property, board } = await editableBoard(ctx, propertyId);
    const no = rawNo.trim();
    const room = board.rooms.find((r) => r.no === oldNo);
    if (room === undefined)
      throw appError("NOT_FOUND", "That room isn't on the board.");
    const problem = roomNoProblem(no);
    if (problem) throw appError("INVALID_INPUT", problem);
    if (
      no.toLowerCase() !== oldNo.toLowerCase() &&
      board.rooms.some((r) => r.no.toLowerCase() === no.toLowerCase())
    )
      throw appError("CONFLICT", `Room ${no} already exists.`);
    if (!board.floors.some((f) => f.n === floor))
      throw appError("INVALID_INPUT", "Pick a floor.");
    const entries = new Map<string, Doc<"bedEntries">>();
    for (const id of bedsOf(room)) {
      const entry = await entryOf(ctx, propertyId, id);
      if (entry !== null) entries.set(id, entry);
    }
    const lost = bedsOf(room)
      .slice(type)
      .filter((id) => entries.has(id));
    if (lost.length > 0) {
      const letters = lost.map((id) => splitBedId(id).letter).join(" and ");
      throw appError(
        "CONFLICT",
        `Bed ${letters} still has someone assigned. Move or vacate them before making this a ${ROOM_TYPE_LABELS[type].toLowerCase()} room.`,
      );
    }
    for (const [id, entry] of entries) {
      await ctx.db.patch(entry._id, {
        bedId: makeBedId(no, splitBedId(id).letter),
      });
    }
    const rooms = board.rooms.map((r) =>
      r.no === oldNo ? { no, floor, type } : r,
    );
    const renamed = no !== oldNo ? ` (now ${no})` : "";
    await recordChange(
      ctx,
      ctx.admin,
      property,
      board,
      `room ${oldNo}${renamed} changed`,
      { rooms },
    );
    return null;
  },
});

/** Saves an edited layout: floors and rooms. Refused if the board changed since `baseVersion`. */
export const saveLayout = adminMutation({
  args: {
    propertyId: v.id("properties"),
    baseVersion: v.number(),
    floors: v.array(vBoardFloor),
    rooms: v.array(
      v.object({
        no: v.string(),
        floor: v.number(),
        type: vRoomType,
        orig: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    ctx,
    { propertyId, baseVersion, floors: rawFloors, rooms: rawRooms },
  ) => {
    const { property, board } = await editableBoard(ctx, propertyId);
    if (board.version !== baseVersion) throw staleError();
    const floors = rawFloors
      .map((f) => ({ n: f.n, name: f.name.trim() || `Floor ${f.n}` }))
      .sort((a, b) => a.n - b.n);
    const floorProblem = floorsProblem(floors);
    if (floorProblem) throw appError("INVALID_INPUT", floorProblem);
    if (rawRooms.length > LIMITS.rooms)
      throw appError("INVALID_INPUT", `At most ${LIMITS.rooms} rooms.`);

    const entries = await entriesOf(ctx, propertyId);
    const takenLetters = (origNo: string) =>
      entries
        .filter((e) => splitBedId(e.bedId).roomNo === origNo)
        .map((e) => splitBedId(e.bedId).letter);
    const origs = rawRooms
      .map((r) => r.orig)
      .filter((o): o is string => o !== undefined);
    if (
      new Set(origs).size !== origs.length ||
      origs.some((o) => !board.rooms.some((r) => r.no === o))
    )
      throw staleError();
    const problems = layoutProblems(floors, rawRooms, takenLetters);
    const first = Object.values(problems)[0];
    if (first) throw appError("INVALID_INPUT", first[0]);
    // Rooms being removed must have nobody assigned.
    for (const room of board.rooms) {
      if (!origs.includes(room.no) && takenLetters(room.no).length > 0)
        throw appError(
          "CONFLICT",
          `Room ${room.no} has someone assigned. Vacate it before removing it.`,
        );
    }

    const newNo = new Map(
      rawRooms
        .filter((r) => r.orig !== undefined)
        .map((r) => [r.orig!, r.no.trim()]),
    );
    for (const entry of entries) {
      const { roomNo, letter } = splitBedId(entry.bedId);
      const target = newNo.get(roomNo);
      if (target !== undefined && target !== roomNo)
        await ctx.db.patch(entry._id, { bedId: makeBedId(target, letter) });
    }
    const rooms = rawRooms.map((r) => ({
      no: r.no.trim(),
      floor: r.floor,
      type: r.type,
    }));
    const beds = rooms.reduce((sum, r) => sum + r.type, 0);
    await recordChange(
      ctx,
      ctx.admin,
      property,
      board,
      `layout saved (${floors.length} floors, ${rooms.length} rooms, ${beds} beds)`,
      {
        floors,
        rooms,
      },
    );
    return null;
  },
});

/**
 * Saves the whole table: every bed's status and details, and the columns.
 * Beds left out become vacant. Refused if the board changed since `baseVersion`.
 */
export const saveTable = adminMutation({
  args: {
    propertyId: v.id("properties"),
    baseVersion: v.number(),
    fields: v.array(vBoardField),
    beds: v.array(
      v.object({ bedId: v.string(), status: vTenantStatus, tenant: vTenant }),
    ),
  },
  handler: async (
    ctx,
    { propertyId, baseVersion, fields: rawFields, beds },
  ) => {
    const { property, board } = await editableBoard(ctx, propertyId);
    if (board.version !== baseVersion) throw staleError();
    const fields: Field[] = rawFields.map((f) => ({
      ...f,
      label: f.label.trim(),
      options:
        f.type === "select"
          ? (f.options ?? []).map((o) => o.trim())
          : undefined,
    }));
    const fieldProblem = fieldsProblem(fields);
    if (fieldProblem) throw appError("INVALID_INPUT", fieldProblem);

    const known = new Set(board.rooms.flatMap((r) => bedsOf(r)));
    const seen = new Set<string>();
    for (const bed of beds) {
      if (!known.has(bed.bedId))
        throw appError(
          "INVALID_INPUT",
          `${bedLabel(bed.bedId)} isn't on the board.`,
        );
      if (seen.has(bed.bedId))
        throw appError(
          "INVALID_INPUT",
          `${bedLabel(bed.bedId)} is listed twice.`,
        );
      seen.add(bed.bedId);
      const problem = Object.values(
        tenantProblems(bed.status, bed.tenant, fields),
      )[0];
      if (problem) {
        const { roomNo, letter } = splitBedId(bed.bedId);
        throw appError(
          "INVALID_INPUT",
          `Room ${roomNo} bed ${letter}: ${problem}`,
        );
      }
    }

    const existing = new Map(
      (await entriesOf(ctx, propertyId)).map((e) => [e.bedId, e]),
    );
    let changed = 0;
    const now = Date.now();
    for (const bed of beds) {
      const tenant = cleanTenant(bed.status, bed.tenant, fields);
      const row = existing.get(bed.bedId);
      existing.delete(bed.bedId);
      if (row === undefined) {
        await ctx.db.insert("bedEntries", {
          propertyId,
          bedId: bed.bedId,
          status: bed.status,
          tenant,
          updatedAt: now,
          updatedBy: ctx.admin.userId,
        });
        changed += 1;
      } else if (
        row.status !== bed.status ||
        JSON.stringify(row.tenant) !== JSON.stringify(tenant)
      ) {
        await ctx.db.patch(row._id, {
          status: bed.status,
          tenant,
          updatedAt: now,
          updatedBy: ctx.admin.userId,
        });
        changed += 1;
      }
    }
    for (const row of existing.values()) {
      await ctx.db.delete(row._id);
      changed += 1;
    }
    const columnsChanged =
      JSON.stringify(board.fields) !== JSON.stringify(fields);
    const detail = `table saved (${changed} ${changed === 1 ? "bed" : "beds"} changed${columnsChanged ? ", columns changed" : ""})`;
    await recordChange(ctx, ctx.admin, property, board, detail, { fields });
    return { changed };
  },
});

function staleError() {
  return appError(
    "CONFLICT",
    "Someone else changed this bed board while you were editing. Your changes weren't saved; reload to see theirs, then make yours again.",
  );
}
