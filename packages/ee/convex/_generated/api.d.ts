/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as agentAvatars from "../agentAvatars.js";
import type * as annotations from "../annotations.js";
import type * as auth from "../auth.js";
import type * as cli from "../cli.js";
import type * as collections from "../collections.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as entitlements from "../entitlements.js";
import type * as http from "../http.js";
import type * as planDeletion from "../planDeletion.js";
import type * as planPreferences from "../planPreferences.js";
import type * as planTags from "../planTags.js";
import type * as planVersions from "../planVersions.js";
import type * as planVisibility from "../planVisibility.js";
import type * as plannotator from "../plannotator.js";
import type * as plans from "../plans.js";
import type * as privacy from "../privacy.js";
import type * as sharing from "../sharing.js";
import type * as stripe from "../stripe.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tags from "../tags.js";
import type * as workspaceAccess from "../workspaceAccess.js";
import type * as workspaceMembers from "../workspaceMembers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  agentAvatars: typeof agentAvatars;
  annotations: typeof annotations;
  auth: typeof auth;
  cli: typeof cli;
  collections: typeof collections;
  comments: typeof comments;
  crons: typeof crons;
  entitlements: typeof entitlements;
  http: typeof http;
  planDeletion: typeof planDeletion;
  planPreferences: typeof planPreferences;
  planTags: typeof planTags;
  planVersions: typeof planVersions;
  planVisibility: typeof planVisibility;
  plannotator: typeof plannotator;
  plans: typeof plans;
  privacy: typeof privacy;
  sharing: typeof sharing;
  stripe: typeof stripe;
  subscriptions: typeof subscriptions;
  tags: typeof tags;
  workspaceAccess: typeof workspaceAccess;
  workspaceMembers: typeof workspaceMembers;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
};
