/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as access from "../access.js";
import type * as activity from "../activity.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as importData from "../importData.js";
import type * as importer from "../importer.js";
import type * as launch from "../launch.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_importPlan from "../lib/importPlan.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_profiles from "../lib/profiles.js";
import type * as lib_ssoSign from "../lib/ssoSign.js";
import type * as lib_syncQueue from "../lib/syncQueue.js";
import type * as lib_validators from "../lib/validators.js";
import type * as people from "../people.js";
import type * as properties from "../properties.js";
import type * as seed from "../seed.js";
import type * as signUp from "../signUp.js";
import type * as sync from "../sync.js";
import type * as syncNode from "../syncNode.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  access: typeof access;
  activity: typeof activity;
  auth: typeof auth;
  authLimits: typeof authLimits;
  crons: typeof crons;
  http: typeof http;
  importData: typeof importData;
  importer: typeof importer;
  launch: typeof launch;
  "lib/activity": typeof lib_activity;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/importPlan": typeof lib_importPlan;
  "lib/inputRules": typeof lib_inputRules;
  "lib/profiles": typeof lib_profiles;
  "lib/ssoSign": typeof lib_ssoSign;
  "lib/syncQueue": typeof lib_syncQueue;
  "lib/validators": typeof lib_validators;
  people: typeof people;
  properties: typeof properties;
  seed: typeof seed;
  signUp: typeof signUp;
  sync: typeof sync;
  syncNode: typeof syncNode;
  tools: typeof tools;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
