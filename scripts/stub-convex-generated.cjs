/*
 * Writes a stand-in for convex/_generated so the backend tests and the
 * typechecks run on a machine (or a CI runner) that is not signed in to Convex.
 *
 * The real bindings come from `npx convex dev` / `npx convex codegen`, which
 * ask the linked deployment for its component definitions and so need an
 * access token. Everything this script writes is derived from the files in
 * convex/ alone:
 *
 *   api.js / api.d.ts       `api` and `internal` as untyped-by-name references
 *                           plus the module list, so `api.world.move` still
 *                           type-checks its arguments against the real handler
 *   server.js / server.d.ts query, mutation, action ... and their contexts
 *   dataModel.d.ts          Doc<> and Id<> from schema.ts
 *
 * What it can't know is the shape of installed components, so `components` is
 * typed `any`. Real codegen output always wins: this script refuses to
 * overwrite a directory that it didn't write itself.
 *
 *   node scripts/stub-convex-generated.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const convexDir = path.resolve(__dirname, "..", "convex");
const outDir = path.join(convexDir, "_generated");
const MARKER = "stub-convex-generated";

if (fs.existsSync(outDir)) {
  const api = path.join(outDir, "api.js");
  const mine = fs.existsSync(api) && fs.readFileSync(api, "utf8").includes(MARKER);
  if (!mine) {
    console.log("convex/_generated is real codegen output; leaving it alone.");
    process.exit(0);
  }
}
fs.mkdirSync(outDir, { recursive: true });

// Every top-level .ts file in convex/ is a module, except config and schema.
const modules = fs
  .readdirSync(convexDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
  .map((f) => f.slice(0, -3))
  .filter((m) => m !== "schema" && m !== "convex.config")
  .sort();

const banner = `/* Written by ${MARKER}. Not real codegen output; do not commit. */\n`;
const write = (name, text) => fs.writeFileSync(path.join(outDir, name), banner + text);

write(
  "api.js",
  `import { anyApi, componentsGeneric } from "convex/server";
export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
`,
);

write(
  "api.d.ts",
  `${modules.map((m) => `import type * as ${m} from "../${m}.js";`).join("\n")}
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
${modules.map((m) => `  ${m}: typeof ${m};`).join("\n")}
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: any;
`,
);

write(
  "server.js",
  `import {
  actionGeneric,
  httpActionGeneric,
  queryGeneric,
  mutationGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;
`,
);

write(
  "server.d.ts",
  `import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

export declare const query: QueryBuilder<DataModel, "public">;
export declare const internalQuery: QueryBuilder<DataModel, "internal">;
export declare const mutation: MutationBuilder<DataModel, "public">;
export declare const internalMutation: MutationBuilder<DataModel, "internal">;
export declare const action: ActionBuilder<DataModel, "public">;
export declare const internalAction: ActionBuilder<DataModel, "internal">;
export declare const httpAction: HttpActionBuilder;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
`,
);

write(
  "dataModel.d.ts",
  `import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`,
);

console.log(`Wrote a stand-in convex/_generated (${modules.length} modules: ${modules.join(", ")}).`);
