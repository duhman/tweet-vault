/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as tweetVault from "../tweetVault.js";
import type * as tweetVaultInternal from "../tweetVaultInternal.js";
import type * as tweetVaultLinks from "../tweetVaultLinks.js";
import type * as tweetVaultMutations from "../tweetVaultMutations.js";
import type * as tweetVaultQueries from "../tweetVaultQueries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "lib/embeddings": typeof lib_embeddings;
  tweetVault: typeof tweetVault;
  tweetVaultInternal: typeof tweetVaultInternal;
  tweetVaultLinks: typeof tweetVaultLinks;
  tweetVaultMutations: typeof tweetVaultMutations;
  tweetVaultQueries: typeof tweetVaultQueries;
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
