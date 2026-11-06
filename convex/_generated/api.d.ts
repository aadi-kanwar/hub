/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as activity from "../activity.js";
import type * as admins from "../admins.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as http from "../http.js";
import type * as launch from "../launch.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_validators from "../lib/validators.js";
import type * as seed from "../seed.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activity: typeof activity;
  admins: typeof admins;
  auth: typeof auth;
  authLimits: typeof authLimits;
  http: typeof http;
  launch: typeof launch;
  "lib/activity": typeof lib_activity;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/inputRules": typeof lib_inputRules;
  "lib/validators": typeof lib_validators;
  seed: typeof seed;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
