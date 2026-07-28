#!/usr/bin/env node
/*
 * Convex typechecks its functions with whatever TypeScript the project
 * resolves, and its shipped .d.ts files use TS5-only syntax. On an older one
 * the run dies with 60-odd TS2792 / TS7006 errors that say nothing about the
 * real cause — which is almost always a node_modules that predates a
 * package.json change.
 *
 * This turns that into a single actionable line.
 */

const REQUIRED_MAJOR = 5;

function fail(lines) {
    console.error(`\n  ${lines.join("\n  ")}\n`);
    process.exit(1);
}

let installed;
try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    installed = require("typescript/package.json").version;
} catch {
    fail([
        "TypeScript is not installed, and Convex needs it to typecheck.",
        "",
        "  Run: npm install",
    ]);
}

const major = Number(String(installed).split(".")[0]);

if (!Number.isFinite(major) || major < REQUIRED_MAJOR) {
    fail([
        `TypeScript ${installed} is installed, but Convex needs ${REQUIRED_MAJOR} or newer.`,
        "Its type definitions use syntax older compilers cannot parse.",
        "",
        "  Run: npm install",
        "",
        "(package.json already pins it — node_modules is just out of date.)",
    ]);
}
