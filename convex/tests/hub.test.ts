import { importSPKI, jwtVerify } from "jose";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { FAILED_ATTEMPTS_LIMIT, LOCKOUT_MS } from "../authLimits";
import {
  HUB_ORIGIN,
  PASSWORD,
  activityTypes,
  addAdmin,
  errorCode,
  nextPhone,
  seedAdmin,
  setupTest,
  signIn,
  signedInAs,
} from "./harness.test-utils";

describe("seed script", () => {
  test("creates the first master admin once, with a forced password change", async () => {
    const t = await setupTest();
    const phone = "+919876543210";
    process.env.SEED_ADMIN_NAME = "Owner";
    process.env.SEED_ADMIN_PHONE = "98765 43210";
    process.env.SEED_ADMIN_PASSWORD = PASSWORD;
    await t.action(internal.seed.createFirstAdmin, {});
    expect(await errorCode(t.action(internal.seed.createFirstAdmin, {}))).toBe("CONFLICT");
    for (const name of ["SEED_ADMIN_NAME", "SEED_ADMIN_PHONE", "SEED_ADMIN_PASSWORD"]) delete process.env[name];
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => [u.name, u.phone, u.status, u.mustChangePassword])).toEqual([
      ["Owner", phone, "active", true],
    ]);
    expect((await signIn(t, "9876543210", PASSWORD)).tokens?.token).toBeTruthy();
    expect(await activityTypes(t)).toEqual(["admin_added", "login"]);
  });

  test("refuses without the environment variables", async () => {
    const t = await setupTest();
    expect(await errorCode(t.action(internal.seed.createFirstAdmin, {}))).toBe("INVALID_INPUT");
  });
});

describe("login", () => {
  test("first sign-in must change the password before using the hub", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const phone = nextPhone();
    const { userId } = await first.as.action(api.admins.create, {
      name: "New Admin",
      phone,
      temporaryPassword: PASSWORD,
    });
    const as = await signedInAs(t, userId);
    expect((await as.query(api.users.me, {}))?.mustChangePassword).toBe(true);
    expect(await errorCode(as.query(api.admins.list, {}))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(as.action(api.launch.ticket, { toolId: "staff" }))).toBe("PASSWORD_CHANGE_REQUIRED");
    await as.action(api.users.changePassword, { newPassword: "my-own-pass-77" });
    expect((await as.query(api.users.me, {}))?.mustChangePassword).toBe(false);
    expect(await as.query(api.admins.list, {})).toHaveLength(2);
    expect((await signIn(t, phone, "my-own-pass-77")).tokens?.token).toBeTruthy();
  });

  test(`locks the number for 15 minutes after ${FAILED_ATTEMPTS_LIMIT} failed attempts`, async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i += 1) {
      expect(await errorCode(signIn(t, admin.phone, "wrong-password"))).toBe("SIGN_IN_FAILED");
    }
    // Even the right password is refused while locked.
    expect(await errorCode(signIn(t, admin.phone, PASSWORD))).toBe("TOO_MANY_ATTEMPTS");
    vi.setSystemTime(Date.now() + LOCKOUT_MS - 60_000);
    expect(await errorCode(signIn(t, admin.phone, PASSWORD))).toBe("TOO_MANY_ATTEMPTS");
    vi.setSystemTime(Date.now() + 61_000);
    expect((await signIn(t, admin.phone, PASSWORD)).tokens?.token).toBeTruthy();
    const types = await activityTypes(t);
    expect(types.filter((x) => x === "login_failed")).toHaveLength(FAILED_ATTEMPTS_LIMIT + 2);
    expect(types.at(-1)).toBe("login");
  });

  test("unknown numbers are locked the same way, and say the same thing", async () => {
    const t = await setupTest();
    const phone = nextPhone();
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i += 1) {
      expect(await errorCode(signIn(t, phone, PASSWORD))).toBe("SIGN_IN_FAILED");
    }
    expect(await errorCode(signIn(t, phone, PASSWORD))).toBe("TOO_MANY_ATTEMPTS");
  });

  test("a successful sign-in resets the count", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT - 1; i += 1) await errorCode(signIn(t, admin.phone, "nope-nope"));
    await signIn(t, admin.phone, PASSWORD);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT - 1; i += 1) await errorCode(signIn(t, admin.phone, "nope-nope"));
    expect((await signIn(t, admin.phone, PASSWORD)).tokens?.token).toBeTruthy();
  });

  test("there is no sign-up", async () => {
    const t = await setupTest();
    const result = await errorCode(
      t.action(api.auth.signIn, {
        provider: "phone-password",
        params: { phone: nextPhone(), password: PASSWORD, flow: "signUp" },
      }),
    );
    expect(result).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });
});

describe("master admin management", () => {
  test("add, deactivate, reactivate and reset", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const second = await addAdmin(t, first);
    expect(
      await errorCode(
        first.as.action(api.admins.create, { name: "Dup Admin", phone: second.phone, temporaryPassword: PASSWORD }),
      ),
    ).toBe("CONFLICT");

    await first.as.action(api.admins.deactivate, { userId: second.userId });
    // Their session ends at once, and they can't sign in.
    expect(await second.as.query(api.users.me, {})).toBeNull();
    expect(await errorCode(signIn(t, second.phone, PASSWORD))).toBe("SIGN_IN_FAILED");

    // Adding the number again switches them back on with a new temporary password.
    const { reactivated } = await first.as.action(api.admins.create, {
      name: "Second Admin",
      phone: second.phone,
      temporaryPassword: "fresh-start-9",
    });
    expect(reactivated).toBe(true);
    expect((await signIn(t, second.phone, "fresh-start-9")).tokens?.token).toBeTruthy();

    await first.as.action(api.admins.resetPassword, { userId: second.userId, temporaryPassword: "another-one-5" });
    expect(await errorCode(signIn(t, second.phone, "fresh-start-9"))).toBe("SIGN_IN_FAILED");
    expect((await signIn(t, second.phone, "another-one-5")).tokens?.token).toBeTruthy();
    const user = await t.run((ctx) => ctx.db.get(second.userId));
    expect(user?.mustChangePassword).toBe(true);

    const types = await activityTypes(t);
    for (const type of ["admin_added", "admin_deactivated", "admin_reactivated", "password_reset"] as const) {
      expect(types).toContain(type);
    }
  });

  test("an admin can't deactivate themselves", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    await addAdmin(t, first);
    expect(await errorCode(first.as.action(api.admins.deactivate, { userId: first.userId }))).toBe("FORBIDDEN");
  });

  test("there is always at least one active master admin", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const second = await addAdmin(t, first);
    await first.as.action(api.admins.deactivate, { userId: second.userId });
    // Even a (now inactive) second admin acting could not remove the last one.
    expect(
      await errorCode(t.mutation(internal.admins.markInactive, { userId: first.userId, actorId: second.userId })),
    ).toBe("FORBIDDEN");
    const active = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_status", (q) => q.eq("status", "active")).collect(),
    );
    expect(active.map((u) => u._id)).toEqual([first.userId]);
  });

  test("signed-out visitors can't use any hub function", async () => {
    const t = await setupTest();
    await seedAdmin(t);
    expect(await t.query(api.users.me, {})).toBeNull();
    expect(await errorCode(t.query(api.admins.list, {}))).toBe("NOT_SIGNED_IN");
    expect(
      await errorCode(t.query(api.activity.list, { paginationOpts: { numItems: 10, cursor: null } })),
    ).toBe("NOT_SIGNED_IN");
    expect(await errorCode(t.action(api.launch.ticket, { toolId: "staff" }))).toBe("NOT_SIGNED_IN");
    expect(
      await errorCode(t.action(api.admins.create, { name: "X Y", phone: nextPhone(), temporaryPassword: PASSWORD })),
    ).toBe("NOT_SIGNED_IN");
  });

  test("the activity log can't be edited or deleted", async () => {
    const t = await setupTest();
    await seedAdmin(t);
    const entry = await t.run(async (ctx) => (await ctx.db.query("activityLog").first())!);
    // Internal mutations use the same guarded database as every other mutation.
    const { guardedDb } = await import("../lib/functions");
    await expect(t.run((ctx) => guardedDb(ctx).delete(entry._id))).rejects.toThrow();
  });
});

describe("tool tickets", () => {
  test("an active master admin gets a signed 60-second ticket in the address fragment", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t, "Asha Rao");
    const { url } = await admin.as.action(api.launch.ticket, { toolId: "mealsync" });
    const [base, fragment] = url.split("#ticket=");
    expect(base).toBe("https://dine.livoza.org/sso");
    expect(url).not.toContain("?");
    const key = await importSPKI(process.env.TEST_SSO_PUBLIC_KEY!, "EdDSA");
    const { payload, protectedHeader } = await jwtVerify(fragment, key, {
      issuer: HUB_ORIGIN,
      audience: "mealsync",
    });
    expect(protectedHeader.alg).toBe("EdDSA");
    expect(payload).toMatchObject({
      sub: admin.userId,
      phone: admin.phone,
      name: "Asha Rao",
      role: "master_admin",
    });
    expect(payload.exp! - payload.iat!).toBe(60);
    expect(typeof payload.jti).toBe("string");
    const log = await t.run((ctx) => ctx.db.query("activityLog").collect());
    expect(log.at(-1)).toMatchObject({ type: "tool_launched", toolId: "mealsync", actorId: admin.userId });
  });

  test("every ticket has a different nonce", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    const one = await admin.as.action(api.launch.ticket, { toolId: "staff" });
    const two = await admin.as.action(api.launch.ticket, { toolId: "staff" });
    expect(one.url).not.toBe(two.url);
  });

  test("a deactivated master admin can't get a ticket", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const second = await addAdmin(t, first);
    await first.as.action(api.admins.deactivate, { userId: second.userId });
    expect(await errorCode(second.as.action(api.launch.ticket, { toolId: "staff" }))).toBe("NOT_SIGNED_IN");
    // Even with a session somehow still open, an inactive account is refused.
    const reopened = await signedInAs(t, second.userId);
    expect(await errorCode(reopened.action(api.launch.ticket, { toolId: "staff" }))).toBe("ACCOUNT_DISABLED");
    expect(await activityTypes(t)).not.toContain("tool_launched");
  });

  test("unknown tools and a missing signing key are refused", async () => {
    const t = await setupTest();
    const admin = await seedAdmin(t);
    expect(await errorCode(admin.as.action(api.launch.ticket, { toolId: "nope" }))).toBe("NOT_FOUND");
    const key = process.env.SSO_PRIVATE_KEY;
    delete process.env.SSO_PRIVATE_KEY;
    try {
      expect(await errorCode(admin.as.action(api.launch.ticket, { toolId: "staff" }))).toBe("SSO_NOT_CONFIGURED");
    } finally {
      process.env.SSO_PRIVATE_KEY = key;
    }
  });
});

describe("revoke in all apps", () => {
  type Sent = { url: string; token: string };

  /** Replaces fetch with fake tool backends; `answer` decides each reply. */
  function fakeTools(answer: (url: string) => Response | Promise<Response>) {
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const header = new Headers(init.headers).get("Authorization") ?? "";
      sent.push({ url, token: header.replace(/^Bearer /, "") });
      return await answer(url);
    });
    return sent;
  }

  async function deactivatedAdmin() {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const second = await addAdmin(t, first);
    await first.as.action(api.admins.deactivate, { userId: second.userId });
    return { t, first, second };
  }

  test("sends each tool a signed one-time revoke request and logs the ones that confirmed", async () => {
    const { t, first, second } = await deactivatedAdmin();
    const sent = fakeTools(() => Response.json({ ok: true, sessionsEnded: 1, adminRemoved: true }));
    try {
      const { results } = await first.as.action(api.launch.revokeEverywhere, { userId: second.userId });
      expect(results).toEqual([
        { toolId: "mealsync", name: "Dine", ok: true },
        { toolId: "staff", name: "Staff", ok: true },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent.map((s) => s.url).sort()).toEqual([
      "https://decisive-axolotl-579.convex.site/sso/revoke",
      "https://pleasant-labrador-141.convex.site/sso/revoke",
    ]);
    const key = await importSPKI(process.env.TEST_SSO_PUBLIC_KEY!, "EdDSA");
    const jtis = new Set<unknown>();
    for (const { url, token } of sent) {
      const audience = url.includes("decisive-axolotl") ? "mealsync-revoke" : "staff-revoke";
      const { payload } = await jwtVerify(token, key, { issuer: HUB_ORIGIN, audience });
      expect(payload).toMatchObject({ sub: second.userId, phone: second.phone });
      expect(payload.role).toBeUndefined();
      expect(payload.exp! - payload.iat!).toBe(60);
      jtis.add(payload.jti);
    }
    expect(jtis.size).toBe(2);
    const log = (await t.run((ctx) => ctx.db.query("activityLog").collect())).filter((e) => e.type === "revoked_in_apps");
    expect(log.map((e) => [e.toolId, e.actorId, e.targetId]).sort()).toEqual([
      ["mealsync", first.userId, second.userId],
      ["staff", first.userId, second.userId],
    ]);
  });

  test("reports a tool that refused or couldn't be reached, and logs only the confirmed one", async () => {
    const { t, first, second } = await deactivatedAdmin();
    fakeTools((url) => {
      if (url.includes("pleasant-labrador")) throw new Error("network down");
      return Response.json({ ok: true, sessionsEnded: 0, adminRemoved: false });
    });
    try {
      const { results } = await first.as.action(api.launch.revokeEverywhere, { userId: second.userId });
      expect(results.map((r) => [r.toolId, r.ok])).toEqual([
        ["mealsync", true],
        ["staff", false],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
    fakeTools(() => Response.json({ ok: false }, { status: 401 }));
    try {
      const { results } = await first.as.action(api.launch.revokeEverywhere, { userId: second.userId });
      expect(results.every((r) => !r.ok)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    const log = (await t.run((ctx) => ctx.db.query("activityLog").collect())).filter((e) => e.type === "revoked_in_apps");
    expect(log.map((e) => e.toolId)).toEqual(["mealsync"]);
  });

  test("only for another, already deactivated master admin, and only by a master admin", async () => {
    const t = await setupTest();
    const first = await seedAdmin(t);
    const second = await addAdmin(t, first);
    const sent = fakeTools(() => Response.json({ ok: true }));
    try {
      expect(await errorCode(first.as.action(api.launch.revokeEverywhere, { userId: second.userId }))).toBe("CONFLICT");
      expect(await errorCode(first.as.action(api.launch.revokeEverywhere, { userId: first.userId }))).toBe("FORBIDDEN");
      expect(await errorCode(t.action(api.launch.revokeEverywhere, { userId: second.userId }))).toBe("NOT_SIGNED_IN");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent).toHaveLength(0);
  });
});
