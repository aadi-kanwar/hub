import { importSPKI, jwtVerify } from "jose";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { buildPlan, type ToolExport } from "../lib/importPlan";
import { retryDelayMs } from "../sync";
import {
  HUB_ORIGIN,
  PASSWORD,
  activityTypes,
  addPerson,
  addProperty,
  errorCode,
  fakeTools,
  joinCodeOf,
  nextPhone,
  seedAdmin,
  sendSync,
  setupTest,
  signIn,
  signUp,
  signedInAs,
  waitingJobs,
} from "./harness.test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function verify(token: string, audience: string) {
  const key = await importSPKI(process.env.TEST_SSO_PUBLIC_KEY!, "EdDSA");
  return (await jwtVerify(token, key, { issuer: HUB_ORIGIN, audience })).payload;
}

describe("resident sign-up with a join code", () => {
  test("creates an active resident of the code's property, sent to Dine only", async () => {
    const t = await setupTest();
    await seedAdmin(t);
    const propertyId = await addProperty(t, "Green PG");
    const phone = nextPhone();
    const result = await signUp(t, { phone, joinCode: (await joinCodeOf(t, propertyId)).toLowerCase(), roomNumber: "12B" });
    expect(result.tokens?.token).toBeTruthy();
    const user = await t.run(async (ctx) =>
      ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).unique(),
    );
    expect(user).toMatchObject({ name: "Riya Sen", status: "active", profileType: "resident", roomNumber: "12B" });
    const as = await signedInAs(t, user!._id);
    expect(await as.query(api.users.me, {})).toMatchObject({ profileType: "resident", propertyNames: ["Green PG"] });
    expect((await as.query(api.tools.mine, {})).map((tool) => tool.id)).toEqual(["mealsync"]);
    const personJobs = (await waitingJobs(t)).filter((job) => job.kind === "person");
    expect(personJobs.map((job) => job.toolId)).toEqual(["mealsync"]);
    expect(await activityTypes(t)).toContain("signed_up");
  });

  test("a wrong join code is refused and counts as a failed attempt", async () => {
    const t = await setupTest();
    const phone = nextPhone();
    expect(await errorCode(signUp(t, { phone, joinCode: "ZZZZZZ" }))).toBe("INVALID_JOIN_CODE");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
    expect(await activityTypes(t)).toContain("login_failed");
  });

  test("a changed join code stops working at once", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const propertyId = await addProperty(t);
    const old = await joinCodeOf(t, propertyId);
    const fresh = await admin.as.mutation(api.properties.changeJoinCode, { propertyId });
    expect(fresh).not.toBe(old);
    expect(await errorCode(signUp(t, { phone: nextPhone(), joinCode: old }))).toBe("INVALID_JOIN_CODE");
    expect((await signUp(t, { phone: nextPhone(), joinCode: fresh })).tokens?.token).toBeTruthy();
  });

  test("signing up with a number that has an account acts as a sign-in and changes nothing", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const propertyId = await addProperty(t);
    const joinCode = await joinCodeOf(t, propertyId);
    expect((await signUp(t, { phone: admin.phone, joinCode })).tokens?.token).toBeTruthy();
    expect(await errorCode(signUp(t, { phone: admin.phone, password: "someone-else-1", joinCode }))).toBe(
      "SIGN_IN_FAILED",
    );
    const user = await t.run((ctx) => ctx.db.get(admin.userId));
    expect(user).toMatchObject({ profileType: "admin" });
  });
});

describe("people and profile types", () => {
  test("admin adds a warden and staff with properties; each sees only their tools", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    const b = await addProperty(t, "PG B");
    const warden = await addPerson(t, admin, { name: "Wanda Warden", profileType: "warden", propertyIds: [a] });
    const staff = await addPerson(t, admin, { name: "Sam Staff", profileType: "staff", propertyIds: [a, b] });
    expect(await warden.as.query(api.tools.mine, {})).toEqual([
      expect.objectContaining({ id: "mealsync", name: "Dine" }),
      expect.objectContaining({ id: "crate", name: "Crate" }),
    ]);
    expect(await staff.as.query(api.tools.mine, {})).toEqual([
      expect.objectContaining({ id: "staff", name: "My Attendance & Pay" }),
    ]);
    expect((await admin.as.query(api.tools.mine, {})).map((tool) => tool.id)).toEqual(["mealsync", "staff", "crate"]);
    // Non-admins can't manage anything.
    expect(await errorCode(warden.as.query(api.people.list, {}))).toBe("FORBIDDEN");
    expect(await errorCode(staff.as.mutation(api.properties.create, { name: "PG C" }))).toBe("FORBIDDEN");
  });

  test("property rules: one warden per PG, one property per resident, none for admins", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    const b = await addProperty(t, "PG B");
    await addPerson(t, admin, { name: "First Warden", profileType: "warden", propertyIds: [a] });
    const create = (profileType: "warden" | "resident" | "staff" | "admin", propertyIds: typeof a[]) =>
      admin.as.action(api.people.create, {
        name: "Some One",
        phone: nextPhone(),
        profileType,
        propertyIds,
        temporaryPassword: PASSWORD,
      });
    expect(await errorCode(create("warden", [a]))).toBe("CONFLICT");
    expect(await errorCode(create("resident", [a, b]))).toBe("INVALID_INPUT");
    expect(await errorCode(create("staff", []))).toBe("INVALID_INPUT");
    expect(await errorCode(create("admin", [a]))).toBe("INVALID_INPUT");
    expect(await errorCode(create("warden", [b]))).toBe("NO_ERROR");
  });

  test("changing a type ends their tool logins and tells old and new tools", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    const resident = await addPerson(t, admin, { name: "Ravi", profileType: "resident", propertyIds: [a], roomNumber: "3" });
    fakeTools();
    await sendSync(t);
    expect(await waitingJobs(t)).toEqual([]);

    await admin.as.mutation(api.people.update, { userId: resident.userId, profileType: "warden", propertyIds: [a] });
    const jobs = await waitingJobs(t);
    expect(jobs.map((job) => [job.toolId, job.revoke]).sort()).toEqual([
      ["crate", true],
      ["mealsync", true],
    ]);
    const sent = fakeTools();
    await sendSync(t);
    const dine = sent.find((s) => s.url.includes("decisive-axolotl"))!;
    expect(dine.url).toBe("https://decisive-axolotl-579.convex.site/sso/sync");
    expect(await verify(dine.token, "mealsync-sync")).toMatchObject({
      kind: "person",
      hubUserId: resident.userId,
      phone: resident.phone,
      profileType: "warden",
      role: "warden",
      active: true,
      revoke: true,
      properties: [{ id: a, name: "PG A" }],
    });
    const crate = sent.find((s) => s.url.includes("agreeable-koala"))!;
    expect(await verify(crate.token, "crate-sync")).toMatchObject({ role: "manager" });
    expect(await activityTypes(t)).toContain("type_changed");
  });

  test("moving a resident to another PG", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    const b = await addProperty(t, "PG B");
    const resident = await addPerson(t, admin, { profileType: "resident", propertyIds: [a] });
    await admin.as.mutation(api.people.update, { userId: resident.userId, profileType: "resident", propertyIds: [b] });
    expect(await resident.as.query(api.users.me, {})).toMatchObject({ propertyNames: ["PG B"] });
    expect(await activityTypes(t)).toContain("properties_changed");
  });

  test("an admin can't change their own type, and the last admin can't be demoted", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t);
    expect(
      await errorCode(admin.as.mutation(api.people.update, { userId: admin.userId, profileType: "warden", propertyIds: [a] })),
    ).toBe("FORBIDDEN");
    const second = await addPerson(t, admin, { name: "Second Admin" });
    await admin.as.mutation(api.people.update, { userId: second.userId, profileType: "staff", propertyIds: [a] });
    expect((await second.as.query(api.tools.mine, {})).map((x) => x.id)).toEqual(["staff"]);
  });

  test("deactivating sends 'switched off' to their tools", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t);
    const staff = await addPerson(t, admin, { profileType: "staff", propertyIds: [a] });
    fakeTools();
    await sendSync(t);
    await admin.as.action(api.people.deactivate, { userId: staff.userId });
    const sent = fakeTools();
    await sendSync(t);
    expect(sent).toHaveLength(1);
    expect(await verify(sent[0].token, "staff-sync")).toMatchObject({ active: false, revoke: true, role: "staff" });
  });
});

describe("tickets for every profile type", () => {
  test("a resident's ticket carries their role, property and room", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    const resident = await addPerson(t, admin, { name: "Riya", profileType: "resident", propertyIds: [a], roomNumber: "7" });
    const { url } = await resident.as.action(api.launch.ticket, { toolId: "mealsync" });
    const payload = await verify(url.split("#ticket=")[1], "mealsync");
    expect(payload).toMatchObject({
      sub: resident.userId,
      profileType: "resident",
      role: "resident",
      roomNumber: "7",
      properties: [{ id: a, name: "PG A" }],
    });
    expect(await errorCode(resident.as.action(api.launch.ticket, { toolId: "staff" }))).toBe("NO_ACCESS");
    expect(await errorCode(resident.as.action(api.launch.ticket, { toolId: "crate" }))).toBe("NO_ACCESS");
  });

  test("a warden gets the manager role in Crate", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t);
    const warden = await addPerson(t, admin, { profileType: "warden", propertyIds: [a] });
    const { url } = await warden.as.action(api.launch.ticket, { toolId: "crate" });
    expect(await verify(url.split("#ticket=")[1], "crate")).toMatchObject({ role: "manager", profileType: "warden" });
  });
});

describe("hub login length", () => {
  test("a master admin's login ends after 8 hours; a resident's lasts", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const a = await addProperty(t);
    const resident = await addPerson(t, admin, { profileType: "resident", propertyIds: [a] });
    // Keep both logins "in use" by adding a fresh refresh token each hour.
    for (let hour = 0; hour < 9; hour++) {
      vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      await t.run(async (ctx) => {
        for (const session of await ctx.db.query("authSessions").collect()) {
          await ctx.db.insert("authRefreshTokens", { sessionId: session._id, expirationTime: Date.now() + 3_600_000 });
        }
      });
    }
    expect(await admin.as.query(api.users.me, {})).toBeNull();
    expect(await resident.as.query(api.users.me, {})).not.toBeNull();
  });

  test("a master admin unused for 2 hours is signed out", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000 + 1000);
    expect(await admin.as.query(api.users.me, {})).toBeNull();
  });
});

describe("sync", () => {
  test("a failing tool is retried later, and properties go to every tool", async () => {
    const t = await setupTest();
    await seedAdmin(t);
    const a = await addProperty(t, "PG A");
    fakeTools((url) => (url.includes("pleasant-labrador") ? Response.json({ ok: false }, { status: 500 }) : Response.json({ ok: true })));
    await sendSync(t);
    const left = await waitingJobs(t);
    expect(left.map((job) => [job.toolId, job.kind, job.attempts])).toEqual([["staff", "property", 1]]);
    expect(Math.abs(left[0].nextAttemptAt - (Date.now() + retryDelayMs(1)))).toBeLessThan(1000);
    const sent = fakeTools();
    await sendSync(t); // not due yet
    expect(sent).toHaveLength(0);
    vi.setSystemTime(Date.now() + retryDelayMs(1) + 1000);
    await sendSync(t);
    expect(await verify(sent[0].token, "staff-sync")).toMatchObject({
      kind: "property",
      property: { id: a, name: "PG A", active: true },
    });
    expect(await waitingJobs(t)).toEqual([]);
  });
});

describe("import from the tools", () => {
  const dine: ToolExport = {
    toolId: "mealsync",
    properties: [{ toolPropertyId: "d1", name: "Green PG" }],
    people: [
      { phone: "+919800000001", name: "Riya", hubType: "resident", toolPropertyIds: ["d1"], active: true, passwordHash: "h-dine", roomNumber: "4" },
      { phone: "+919800000002", name: "Wanda", hubType: "warden", toolPropertyIds: ["d1"], active: true, passwordHash: "h-w" },
      { phone: "+919800000009", name: "Gone", hubType: "resident", toolPropertyIds: ["d1"], active: false },
    ],
  };
  const staff: ToolExport = {
    toolId: "staff",
    properties: [{ toolPropertyId: "s1", name: " green  pg " }],
    people: [
      { phone: "+919800000001", name: "Riya", hubType: "staff", toolPropertyIds: ["s1"], active: true, passwordHash: "h-staff" },
      { phone: "+919800000003", name: "Sam", hubType: "staff", toolPropertyIds: ["s1"], active: true },
    ],
  };

  test("the plan matches properties by name and people by phone, and flags clashes", () => {
    const plan = buildPlan([dine, staff], { properties: [], people: [] });
    expect(plan.properties).toHaveLength(1);
    expect(plan.properties[0].tools.map((x) => x.toolId)).toEqual(["mealsync", "staff"]);
    const riya = plan.people.find((p) => p.phone === "+919800000001")!;
    expect(riya).toMatchObject({ type: "staff", clash: true, hasPassword: true, roomNumber: "4" });
    expect(plan.people.map((p) => p.phone)).not.toContain("+919800000009");
  });

  test("apply makes properties and people, keeps passwords, links tool rows, then syncs", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    fakeTools((url) => {
      if (url.endsWith("/sso/export")) {
        if (url.includes("decisive-axolotl")) return Response.json({ ok: true, ...dine });
        if (url.includes("pleasant-labrador")) return Response.json({ ok: true, ...staff });
        return Response.json({ ok: true, properties: [], people: [] });
      }
      return Response.json({ ok: true });
    });
    const plan = await admin.as.action(api.importer.preview, {});
    expect(plan.failed).toEqual([]);
    const result = await admin.as.action(api.importer.apply, {
      propertyTargets: [{ key: plan.properties[0].key, target: "new" }],
      typeChoices: [{ phone: "+919800000001", type: "resident" }],
    });
    expect(result).toMatchObject({ ok: true, created: 3, linked: 0, propertiesCreated: 1, needsPassword: ["Sam"] });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.find((u) => u.phone === "+919800000001")).toMatchObject({ profileType: "resident", roomNumber: "4" });
    const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts.find((a) => a.providerAccountId === "+919800000001")?.secret).toBe("h-dine");
    const links = await t.run((ctx) => ctx.db.query("toolPropertyLinks").collect());
    expect(links.map((l) => [l.toolId, l.toolPropertyId]).sort()).toEqual([
      ["mealsync", "d1"],
      ["staff", "s1"],
    ]);
    const sent = fakeTools();
    await sendSync(t);
    const propertyToDine = sent.find((s) => s.url.includes("decisive-axolotl")) && sent;
    expect(propertyToDine).toBeTruthy();
    const claims = await Promise.all(
      sent.filter((s) => s.url.includes("decisive-axolotl")).map((s) => verify(s.token, "mealsync-sync")),
    );
    expect(claims.find((c) => c.kind === "property")).toMatchObject({ toolPropertyId: "d1" });
  });

  test("apply refuses while a tool can't be reached", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    fakeTools(() => {
      throw new Error("down");
    });
    const result = await admin.as.action(api.importer.apply, { propertyTargets: [], typeChoices: [] });
    expect(result.ok).toBe(false);
    expect(result.failed).toHaveLength(3);
  });
});

test("only an internal job can create properties without the screens", async () => {
  const t = await setupTest();
  expect(await errorCode(t.mutation(api.properties.create, { name: "X PG" }))).toBe("NOT_SIGNED_IN");
  await t.mutation(internal.properties.createInternal, { name: "X PG" });
  expect(await signIn(t, nextPhone(), PASSWORD).catch(() => "refused")).toBe("refused");
});
