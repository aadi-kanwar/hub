import { importPKCS8, SignJWT, type JWTPayload } from "jose";
import { appError } from "./errors";

/**
 * Signing for everything the hub sends to tools: sign-in tickets, sync,
 * export and revoke requests. Only "use node" files import this.
 *
 * Every token: EdDSA (Ed25519), issuer = the hub's address, an audience
 * naming the tool and purpose, a random one-time `jti`, valid 60 seconds.
 * The private key is only in SSO_PRIVATE_KEY and is never logged or returned.
 */

/** How long a ticket or request is valid. */
export const TICKET_LIFETIME_SECONDS = 60;

/** The hub's own web address (its origin), which tools check as the issuer. */
export function hubOrigin(): string | null {
  try {
    return new URL(process.env.SITE_URL ?? "").origin;
  } catch {
    return null;
  }
}

async function signingKey() {
  const pem = process.env.SSO_PRIVATE_KEY;
  if (!pem) throw appError("SSO_NOT_CONFIGURED");
  try {
    return await importPKCS8(pem.replace(/\\n/g, "\n"), "EdDSA");
  } catch {
    throw appError("SSO_NOT_CONFIGURED");
  }
}

export async function signForTool(claims: JWTPayload, audience: string, subject: string): Promise<string> {
  const issuer = hubOrigin();
  if (issuer === null) throw appError("SSO_NOT_CONFIGURED");
  const key = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + TICKET_LIFETIME_SECONDS)
    .sign(key);
}

/** How long a tool gets to answer. */
export const TOOL_TIMEOUT_MS = 15_000;

/** POSTs a signed request to a tool's backend; returns its JSON reply, or throws a short reason. */
export async function callTool(url: string, token: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
  } catch {
    throw new Error("The tool didn't answer.");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body === null || body.ok !== true) {
    throw new Error(`The tool refused (${response.status}).`);
  }
  return body;
}
