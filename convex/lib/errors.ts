import { ConvexError } from "convex/values";

/**
 * Error codes the browser can recognise. Messages are written for the
 * people using the hub, never for programmers, and never reveal private details.
 */
export type AppErrorCode =
  | "NOT_SIGNED_IN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SIGN_IN_FAILED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_PHONE"
  | "WEAK_PASSWORD"
  | "SSO_NOT_CONFIGURED"
  | "INVALID_JOIN_CODE"
  | "NO_ACCESS";

export type AppErrorData = { code: AppErrorCode; message: string };

export const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  NOT_SIGNED_IN: "Please sign in to continue.",
  PASSWORD_CHANGE_REQUIRED: "Please choose a new password first.",
  ACCOUNT_DISABLED: "This account has been switched off. Please contact your PG's admin.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  INVALID_INPUT: "Some details aren't valid. Please check and try again.",
  CONFLICT: "That has already been done.",
  SIGN_IN_FAILED:
    "That mobile number and password didn't work. Please check and try again.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Please wait 15 minutes and try again.",
  INVALID_PHONE: "Enter a valid mobile number.",
  WEAK_PASSWORD: "Please choose a stronger password.",
  SSO_NOT_CONFIGURED: "This tool isn't connected to the hub yet. Please try again later.",
  INVALID_JOIN_CODE: "That join code didn't work. Ask your PG for the current code.",
  NO_ACCESS: "Your profile doesn't have access to this tool.",
};

export function appError(
  code: AppErrorCode,
  message?: string,
): ConvexError<AppErrorData> {
  return new ConvexError({ code, message: message ?? DEFAULT_MESSAGES[code] });
}
