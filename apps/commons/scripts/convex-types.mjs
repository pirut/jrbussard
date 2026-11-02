/*
 * Writes convex/_generated without a Convex deployment, so CI can run the
 * app's typecheck with no secrets and nothing deployed.
 *
 * `npx convex codegen` normally asks a deployment to analyse the app; with
 * the (hidden) --system-udfs flag it writes the same api/server/dataModel
 * files from the source alone. That leaves out the `components` export,
 * which convex/game.ts uses for the rate limiter, so it is added here in
 * the form codegen itself writes for an npm component:
 *
 *   rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">
 *
 * and api.js gets `components = componentsGeneric()`, as codegen writes it,
 * so the root's convex-test suites (npm run test:commons) run against it too.
 * Does nothing if convex/_generated already exists (from `npx convex dev`),
 * unless run with --force.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const generated = path.join(root, 'convex/_generated/api.d.ts');

if (existsSync(generated) && !process.argv.includes('--force')) {
  console.log('convex/_generated already exists; leaving it alone (--force to rewrite).');
  process.exit(0);
}

const env = { ...process.env };
delete env.CONVEX_DEPLOYMENT;
delete env.CONVEX_DEPLOY_KEY;
execFileSync('npx', ['convex', 'codegen', '--system-udfs', '--typecheck', 'disable'], { cwd: root, stdio: 'inherit', env });

/* app.use(x) and app.use(x, { name: "y" }), with x imported from "<pkg>/convex.config". */
const config = readFileSync(path.join(root, 'convex/convex.config.ts'), 'utf8');
const packages = new Map(
  [...config.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)\/convex\.config(?:\.js)?["']/g)].map((m) => [m[1], m[2]]),
);
const used = [...config.matchAll(/app\.use\(\s*(\w+)\s*(?:,\s*\{\s*name:\s*["'](\w+)["']\s*\})?\s*\)/g)].map((m) => {
  const pkg = packages.get(m[1]);
  if (!pkg) throw new Error(`convex.config.ts uses ${m[1]}, which is not imported from a package's convex.config`);
  return { name: m[2] ?? m[1], pkg };
});

const api = readFileSync(generated, 'utf8');
if (used.length && !/export declare const components/.test(api)) {
  const lines = used.map(
    ({ name, pkg }) => `  ${name}: import("${pkg}/_generated/component.js").ComponentApi<"${name}">;`,
  );
  appendFileSync(generated, `\nexport declare const components: {\n${lines.join('\n')}\n};\n`);
  const runtime = generated.replace(/\.d\.ts$/, '.js');
  const js = readFileSync(runtime, 'utf8');
  if (!/export const components/.test(js)) {
    writeFileSync(
      runtime,
      js.replace('import { anyApi } from "convex/server";', 'import { anyApi, componentsGeneric } from "convex/server";') +
        '\nexport const components = componentsGeneric();\n',
    );
  }
}
console.log(`convex/_generated written offline (components: ${used.map((u) => u.name).join(', ') || 'none'}).`);
