/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authNode from "../authNode.js";
import type * as backup from "../backup.js";
import type * as claims from "../claims.js";
import type * as creature from "../creature.js";
import type * as crons from "../crons.js";
import type * as engine_catalog from "../engine/catalog.js";
import type * as engine_creature from "../engine/creature.js";
import type * as engine_events from "../engine/events.js";
import type * as engine_fallback from "../engine/fallback.js";
import type * as engine_growth from "../engine/growth.js";
import type * as engine_moments from "../engine/moments.js";
import type * as engine_phenotype from "../engine/phenotype.js";
import type * as engine_prompt from "../engine/prompt.js";
import type * as engine_rng from "../engine/rng.js";
import type * as engine_schemas from "../engine/schemas.js";
import type * as engine_sha256 from "../engine/sha256.js";
import type * as engine_sim from "../engine/sim.js";
import type * as engine_time from "../engine/time.js";
import type * as engine_types from "../engine/types.js";
import type * as interact from "../interact.js";
import type * as jobs from "../jobs.js";
import type * as lib_context from "../lib/context.js";
import type * as lib_core from "../lib/core.js";
import type * as lib_exporter from "../lib/exporter.js";
import type * as lib_jobs from "../lib/jobs.js";
import type * as lib_queue from "../lib/queue.js";
import type * as lib_view from "../lib/view.js";
import type * as lib_world from "../lib/world.js";
import type * as memories from "../memories.js";
import type * as mind from "../mind.js";
import type * as openai from "../openai.js";
import type * as public_ from "../public.js";
import type * as settings from "../settings.js";
import type * as sim from "../sim.js";
import type * as touch from "../touch.js";
import type * as validators from "../validators.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  authNode: typeof authNode;
  backup: typeof backup;
  claims: typeof claims;
  creature: typeof creature;
  crons: typeof crons;
  "engine/catalog": typeof engine_catalog;
  "engine/creature": typeof engine_creature;
  "engine/events": typeof engine_events;
  "engine/fallback": typeof engine_fallback;
  "engine/growth": typeof engine_growth;
  "engine/moments": typeof engine_moments;
  "engine/phenotype": typeof engine_phenotype;
  "engine/prompt": typeof engine_prompt;
  "engine/rng": typeof engine_rng;
  "engine/schemas": typeof engine_schemas;
  "engine/sha256": typeof engine_sha256;
  "engine/sim": typeof engine_sim;
  "engine/time": typeof engine_time;
  "engine/types": typeof engine_types;
  interact: typeof interact;
  jobs: typeof jobs;
  "lib/context": typeof lib_context;
  "lib/core": typeof lib_core;
  "lib/exporter": typeof lib_exporter;
  "lib/jobs": typeof lib_jobs;
  "lib/queue": typeof lib_queue;
  "lib/view": typeof lib_view;
  "lib/world": typeof lib_world;
  memories: typeof memories;
  mind: typeof mind;
  openai: typeof openai;
  public: typeof public_;
  settings: typeof settings;
  sim: typeof sim;
  touch: typeof touch;
  validators: typeof validators;
  world: typeof world;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
