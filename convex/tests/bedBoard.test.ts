import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_FIELDS, STARTER_LAYOUT } from "../lib/bedBoard";
import {
  activityTypes,
  addPerson,
  addProperty,
  errorCode,
  seedAdmin,
  setupTest,
  type T,
} from "./harness.test-utils";

const TENANT = {
  name: "Rohan Sharma",
  phone: "98765 43210",
  occupation: "Software engineer",
  checkIn: "2027-01-10",
  rent: "₹ 11,000",
  deposit: "11000",
  rentStatus: "Paid",
  idProof: "Aadhaar, verified",
  emergency: "Mr Sharma (parent)",
  notes: "Prefers the window side",
  moveIn: "2027-05-01", // not used for current tenants: dropped
};

async function setup() {
  const t = await setupTest();
  const admin = await seedAdmin(t);
  const propertyId = await addProperty(t, "Green PG");
  const otherId = await addProperty(t, "Blue PG");
  await admin.as.mutation(api.bedBoard.create, {
    propertyId,
    start: "starter",
  });
  return { t, admin, propertyId, otherId };
}

const board = (
  as: Awaited<ReturnType<typeof seedAdmin>>["as"],
  propertyId: Id<"properties">,
) => as.query(api.bedBoard.get, { propertyId });

async function entries(t: T, propertyId: Id<"properties">) {
  return await t.run((ctx) =>
    ctx.db
      .query("bedEntries")
      .withIndex("by_property_bed", (q) => q.eq("propertyId", propertyId))
      .collect(),
  );
}

describe("setting up", () => {
  test("starts with the earlier bed board's rooms and the default columns, once", async () => {
    const { admin, propertyId } = await setup();
    const b = (await board(admin.as, propertyId))!;
    expect(b.floors.map((f) => f.name)).toEqual([
      "Floor 2",
      "Floor 3",
      "Floor 4",
      "Floor 5",
    ]);
    expect(b.rooms).toHaveLength(46);
    expect(b.rooms.reduce((n, r) => n + r.type, 0)).toBe(95);
    expect(b.rooms).toEqual(STARTER_LAYOUT.rooms);
    expect(b.fields).toEqual(DEFAULT_FIELDS);
    expect(b.beds).toEqual([]);
    expect(b.canEdit).toBe(true);
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.create, { propertyId, start: "empty" }),
      ),
    ).toBe("CONFLICT");
  });

  test("an empty board has one floor and no rooms; a property without a board reads as null", async () => {
    const { admin, otherId } = await setup();
    expect(await board(admin.as, otherId)).toBeNull();
    await admin.as.mutation(api.bedBoard.create, {
      propertyId: otherId,
      start: "empty",
    });
    const b = (await board(admin.as, otherId))!;
    expect(b.floors).toEqual([{ n: 1, name: "Floor 1" }]);
    expect(b.rooms).toEqual([]);
  });
});

describe("beds", () => {
  test("checking in keeps only the current-tenant columns and stores amounts as numbers", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "203-A",
      status: "occupied",
      tenant: TENANT,
    });
    const [row] = await entries(t, propertyId);
    expect(row.status).toBe("occupied");
    expect(row.tenant.rent).toBe(11000);
    expect(row.tenant.deposit).toBe(11000);
    expect(row.tenant.moveIn).toBeUndefined();
    expect(row.tenant.name).toBe("Rohan Sharma");
    expect(await activityTypes(t)).toContain("bed_board_changed");
    const log = await t.run((ctx) => ctx.db.query("activityLog").collect());
    expect(log.at(-1)?.detail).toBe("Green PG: room 203 bed A checked in");
  });

  test("names, move-out dates for notice and move-in dates for bookings are required", async () => {
    const { admin, propertyId } = await setup();
    const save = (
      status: "occupied" | "notice" | "reserved",
      tenant: Record<string, string>,
    ) =>
      errorCode(
        admin.as.mutation(api.bedBoard.saveBed, {
          propertyId,
          bedId: "201-A",
          status,
          tenant,
        }),
      );
    expect(await save("occupied", { phone: "1" })).toBe("INVALID_INPUT");
    expect(await save("notice", { name: "A" })).toBe("INVALID_INPUT");
    expect(await save("reserved", { name: "A" })).toBe("INVALID_INPUT");
    expect(await save("reserved", { name: "A", moveIn: "next week" })).toBe(
      "INVALID_INPUT",
    );
    expect(await save("occupied", { name: "A", rentStatus: "Maybe" })).toBe(
      "INVALID_INPUT",
    );
    expect(await save("reserved", { name: "A", moveIn: "2027-05-01" })).toBe(
      "NO_ERROR",
    );
  });

  test("marking vacant removes the tenant; unknown beds are refused", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "203-C",
      status: "occupied",
      tenant: { name: "A" },
    });
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "203-C",
      status: "vacant",
      tenant: {},
    });
    expect(await entries(t, propertyId)).toHaveLength(0);
    // Room 201 is a double: it has no bed C.
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveBed, {
          propertyId,
          bedId: "201-C",
          status: "occupied",
          tenant: { name: "A" },
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("who can see and change it", () => {
  test("a warden sees their property's board read-only, without money, ID proof or hidden columns", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "203-A",
      status: "occupied",
      tenant: TENANT,
    });
    const warden = await addPerson(t, admin, {
      name: "Ward En",
      profileType: "warden",
      propertyIds: [propertyId],
    });

    const places = await warden.as.query(api.bedBoard.places, {});
    expect(places.canEdit).toBe(false);
    expect(places.properties.map((p) => p.name)).toEqual(["Green PG"]);

    const b = (await board(warden.as, propertyId))!;
    expect(b.canEdit).toBe(false);
    expect(b.fields.map((f) => f.k)).toEqual([
      "name",
      "phone",
      "occupation",
      "moveIn",
      "checkIn",
      "moveOut",
      "emergency",
      "notes",
    ]);
    expect(b.beds[0].tenant).toEqual({
      name: "Rohan Sharma",
      phone: "98765 43210",
      occupation: "Software engineer",
      checkIn: "2027-01-10",
      emergency: "Mr Sharma (parent)",
      notes: "Prefers the window side",
    });
    expect(JSON.stringify(b)).not.toMatch(/11000|Aadhaar|Paid/);

    expect(
      await errorCode(
        warden.as.mutation(api.bedBoard.saveBed, {
          propertyId,
          bedId: "203-B",
          status: "occupied",
          tenant: { name: "X" },
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("a column becomes visible to wardens only when an admin allows it", async () => {
    const { t, admin, propertyId } = await setup();
    const b = (await board(admin.as, propertyId))!;
    const food = {
      k: "cfood",
      label: "Food preference",
      type: "text" as const,
      on: b.fields[0].on,
      warden: false,
    };
    await admin.as.mutation(api.bedBoard.saveTable, {
      propertyId,
      baseVersion: b.version,
      fields: [...b.fields, food],
      beds: [
        {
          bedId: "203-A",
          status: "occupied",
          tenant: { name: "A", cfood: "Veg", rent: 9000 },
        },
      ],
    });
    const warden = await addPerson(t, admin, {
      name: "Ward En",
      profileType: "warden",
      propertyIds: [propertyId],
    });
    expect((await board(warden.as, propertyId))!.beds[0].tenant).toEqual({
      name: "A",
    });

    const b2 = (await board(admin.as, propertyId))!;
    await admin.as.mutation(api.bedBoard.saveTable, {
      propertyId,
      baseVersion: b2.version,
      fields: b2.fields.map((f) =>
        f.k === "cfood" ? { ...f, warden: true } : f,
      ),
      beds: b2.beds,
    });
    expect((await board(warden.as, propertyId))!.beds[0].tenant).toEqual({
      name: "A",
      cfood: "Veg",
    });
  });

  test("other properties' wardens, staff and residents can't open it", async () => {
    const { t, admin, propertyId, otherId } = await setup();
    const otherWarden = await addPerson(t, admin, {
      name: "Other",
      profileType: "warden",
      propertyIds: [otherId],
    });
    expect(await errorCode(board(otherWarden.as, propertyId))).toBe(
      "NOT_FOUND",
    );
    const staff = await addPerson(t, admin, {
      name: "Staff",
      profileType: "staff",
      propertyIds: [propertyId],
    });
    expect(await errorCode(board(staff.as, propertyId))).toBe("FORBIDDEN");
    expect(await errorCode(staff.as.query(api.bedBoard.places, {}))).toBe(
      "FORBIDDEN",
    );
    const resident = await addPerson(t, admin, {
      name: "Res",
      profileType: "resident",
      propertyIds: [propertyId],
      roomNumber: "203",
    });
    expect(await errorCode(board(resident.as, propertyId))).toBe("FORBIDDEN");
    expect(await errorCode(t.query(api.bedBoard.get, { propertyId }))).toBe(
      "NOT_SIGNED_IN",
    );
  });
});

describe("rooms and layout", () => {
  test("renumbering a room keeps its tenants; shrinking an occupied bed is refused", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "203-C",
      status: "occupied",
      tenant: { name: "C" },
    });
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveRoom, {
          propertyId,
          oldNo: "203",
          no: "203",
          floor: 2,
          type: 2,
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveRoom, {
          propertyId,
          oldNo: "203",
          no: "201",
          floor: 2,
          type: 3,
        }),
      ),
    ).toBe("CONFLICT");
    await admin.as.mutation(api.bedBoard.saveRoom, {
      propertyId,
      oldNo: "203",
      no: "250",
      floor: 3,
      type: 4,
    });
    expect((await entries(t, propertyId)).map((e) => e.bedId)).toEqual([
      "250-C",
    ]);
    const b = (await board(admin.as, propertyId))!;
    expect(b.rooms.find((r) => r.no === "250")).toEqual({
      no: "250",
      floor: 3,
      type: 4,
    });
  });

  test("layout saves move tenants with their rooms, refuse removing occupied rooms, and refuse stale copies", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "201-B",
      status: "occupied",
      tenant: { name: "B" },
    });
    const b = (await board(admin.as, propertyId))!;
    const rooms = b.rooms.map((r) => ({ ...r, orig: r.no }));

    const withoutRoom201 = rooms.filter((r) => r.no !== "201");
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveLayout, {
          propertyId,
          baseVersion: b.version,
          floors: b.floors,
          rooms: withoutRoom201,
        }),
      ),
    ).toBe("CONFLICT");

    const renumbered = rooms.map((r) =>
      r.no === "201" ? { ...r, no: "2001" } : r,
    );
    await admin.as.mutation(api.bedBoard.saveLayout, {
      propertyId,
      baseVersion: b.version,
      floors: [...b.floors, { n: 6, name: "Terrace" }],
      rooms: [...renumbered, { no: "601", floor: 6, type: 1 }],
    });
    expect((await entries(t, propertyId)).map((e) => e.bedId)).toEqual([
      "2001-B",
    ]);
    const after = (await board(admin.as, propertyId))!;
    expect(after.rooms).toHaveLength(47);
    expect(after.floors.at(-1)).toEqual({ n: 6, name: "Terrace" });

    // A save based on the older copy is refused.
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveLayout, {
          propertyId,
          baseVersion: b.version,
          floors: b.floors,
          rooms,
        }),
      ),
    ).toBe("CONFLICT");
    // Duplicate room numbers are refused.
    expect(
      await errorCode(
        admin.as.mutation(api.bedBoard.saveLayout, {
          propertyId,
          baseVersion: after.version,
          floors: after.floors,
          rooms: [
            ...after.rooms.map((r) => ({ ...r, orig: r.no })),
            { no: "601", floor: 6, type: 2 },
          ],
        }),
      ),
    ).toBe("INVALID_INPUT");
  });
});

describe("table", () => {
  test("saving the table replaces every bed; required columns can't be removed", async () => {
    const { t, admin, propertyId } = await setup();
    await admin.as.mutation(api.bedBoard.saveBed, {
      propertyId,
      bedId: "201-A",
      status: "occupied",
      tenant: { name: "Old" },
    });
    const b = (await board(admin.as, propertyId))!;
    const { changed } = await admin.as.mutation(api.bedBoard.saveTable, {
      propertyId,
      baseVersion: b.version,
      fields: b.fields,
      beds: [
        {
          bedId: "202-A",
          status: "reserved",
          tenant: { name: "New", moveIn: "2027-05-01" },
        },
        {
          bedId: "202-B",
          status: "notice",
          tenant: { name: "Leaving", moveOut: "2027-04-30" },
        },
      ],
    });
    expect(changed).toBe(3);
    expect((await entries(t, propertyId)).map((e) => e.bedId).sort()).toEqual([
      "202-A",
      "202-B",
    ]);

    const b2 = (await board(admin.as, propertyId))!;
    const save = (fields: typeof b2.fields, beds = b2.beds) =>
      errorCode(
        admin.as.mutation(api.bedBoard.saveTable, {
          propertyId,
          baseVersion: b2.version,
          fields,
          beds,
        }),
      );
    expect(await save(b2.fields.filter((f) => f.k !== "moveOut"))).toBe(
      "INVALID_INPUT",
    );
    expect(
      await save(
        b2.fields.map((f) => (f.k === "name" ? { ...f, warden: false } : f)),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await save(b2.fields, [
        { bedId: "202-A", status: "reserved", tenant: { name: "No date" } },
      ]),
    ).toBe("INVALID_INPUT");
    expect(
      await save(b2.fields, [
        { bedId: "999-A", status: "occupied", tenant: { name: "Ghost" } },
      ]),
    ).toBe("INVALID_INPUT");
    // Renaming a required column is fine.
    expect(
      await save(
        b2.fields.map((f) => (f.k === "name" ? { ...f, label: "Tenant" } : f)),
      ),
    ).toBe("NO_ERROR");
    // That save changed the board, so the old copy is now stale.
    expect(await save(b2.fields)).toBe("CONFLICT");
  });
});
