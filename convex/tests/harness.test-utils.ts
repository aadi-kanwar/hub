/// <reference types="vite/client" />
// Shared helpers for backend tests. The double extension keeps Convex from
// deploying this file as a backend module.
import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

export const modules = import.meta.glob("../**/*.ts");

export const PASSWORD = "plain-tea-42";
export const HUB_ORIGIN = "https://hub.example.com";

/** Keys Convex Auth needs to issue login tokens, and a test SSO signing key. */
async function configureEnv() {
  if (process.env.JWT_PRIVATE_KEY) return;
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
  process.env.CONVEX_SITE_URL = "https://test.convex.site";
  process.env.SITE_URL = HUB_ORIGIN;
  const sso = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  process.env.SSO_PRIVATE_KEY = await exportPKCS8(sso.privateKey);
  process.env.TEST_SSO_PUBLIC_KEY = await exportSPKI(sso.publicKey);
}

export async function setupTest() {
  await configureEnv();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-04-20T06:30:00Z"));
  return convexTest(schema, modules);
}

export type T = Awaited<ReturnType<typeof setupTest>>;

let phoneCounter = 0;
export function nextPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}

export const signIn = (t: T, phone: string, password: string) =>
  t.action(api.auth.signIn, { provider: "phone-password", params: { phone, password } });

/** A client signed in as `userId` (a fresh session). */
export async function signedInAs(t: T, userId: Id<"users">) {
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }),
  );
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

/** The first master admin, created by the seed script, past the first-login password change. */
export async function seedAdmin(t: T, name = "First Admin") {
  const phone = nextPhone();
  process.env.SEED_ADMIN_NAME = name;
  process.env.SEED_ADMIN_PHONE = phone;
  process.env.SEED_ADMIN_PASSWORD = PASSWORD;
  try {
    await t.action(internal.seed.createFirstAdmin, {});
  } finally {
    delete process.env.SEED_ADMIN_NAME;
    delete process.env.SEED_ADMIN_PHONE;
    delete process.env.SEED_ADMIN_PASSWORD;
  }
  const userId = await t.run(async (ctx) => {
    const user = (await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .unique())!;
    await ctx.db.patch(user._id, { mustChangePassword: false });
    return user._id;
  });
  return { userId, phone, as: await signedInAs(t, userId) };
}

export type Admin = Awaited<ReturnType<typeof seedAdmin>>;

/** Another master admin added through the real action, past the first-login password change. */
export async function addAdmin(t: T, by: Admin, name = "Second Admin") {
  const phone = nextPhone();
  const { userId } = await by.as.action(api.admins.create, { name, phone, temporaryPassword: PASSWORD });
  await t.run((ctx) => ctx.db.patch(userId, { mustChangePassword: false }));
  return { userId, phone, as: await signedInAs(t, userId) };
}

/** The ConvexError code thrown by `promise`, or "NO_ERROR". */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String(data.code);
    return `UNEXPECTED: ${(error as Error).message}`;
  }
}

export async function activityTypes(t: T) {
  return (await t.run((ctx) => ctx.db.query("activityLog").collect())).map((e) => e.type);
}
