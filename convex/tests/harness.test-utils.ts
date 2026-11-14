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
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2027-04-20T06:30:00Z"));
  // Scheduled sync sends never reach a real tool; tests call sendSync() with fakeTools().
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

/** Another person added by a master admin through the real action, past the first-login password change. */
export async function addPerson(
  t: T,
  by: Admin,
  options: {
    name?: string;
    profileType?: "admin" | "warden" | "staff" | "resident";
    propertyIds?: Id<"properties">[];
    roomNumber?: string;
  } = {},
) {
  const phone = nextPhone();
  const { userId } = await by.as.action(api.people.create, {
    name: options.name ?? "Second Admin",
    phone,
    profileType: options.profileType ?? "admin",
    propertyIds: options.propertyIds ?? [],
    roomNumber: options.roomNumber,
    temporaryPassword: PASSWORD,
  });
  await t.run((ctx) => ctx.db.patch(userId, { mustChangePassword: false }));
  return { userId, phone, as: await signedInAs(t, userId) };
}

export const addAdmin = (t: T, by: Admin, name = "Second Admin") => addPerson(t, by, { name });

export async function addProperty(t: T, name = "Green PG") {
  return await t.mutation(internal.properties.createInternal, { name });
}

export async function joinCodeOf(t: T, propertyId: Id<"properties">) {
  return await t.run(async (ctx) => (await ctx.db.get(propertyId))!.joinCode);
}

/** Signs up a resident with a join code (the real login flow). */
export const signUp = (
  t: T,
  params: { phone: string; password?: string; name?: string; joinCode: string; roomNumber?: string },
) =>
  t.action(api.auth.signIn, {
    provider: "phone-password",
    params: {
      flow: "signUp",
      phone: params.phone,
      password: params.password ?? PASSWORD,
      name: params.name ?? "Riya Sen",
      joinCode: params.joinCode,
      roomNumber: params.roomNumber ?? "204",
    },
  });

export type Sent = { url: string; token: string };

/**
 * Replaces fetch with fake tool backends; `answer` decides each reply (by
 * default every tool says ok). Returns what was sent.
 */
export function fakeTools(answer: (url: string) => Response | Promise<Response> = () => Response.json({ ok: true })) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const header = new Headers(init.headers).get("Authorization") ?? "";
    sent.push({ url, token: header.replace(/^Bearer /, "") });
    return await answer(url);
  });
  return sent;
}

/** Runs the queued sync jobs now (normally done by the scheduler and the cron). */
export async function sendSync(t: T) {
  await t.action(internal.syncNode.sendDue, {});
}

export async function waitingJobs(t: T) {
  return await t.run((ctx) => ctx.db.query("syncJobs").collect());
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
