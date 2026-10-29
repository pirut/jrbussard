import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Every place that draws through the ASCII pass has to hand it the camera
 * the scene was drawn with. Without it the pass cannot tell whether last
 * frame's cells still line up, and before review finding 3 a caller that
 * left the camera uniforms alone (the 404 page's orbiting Diorama) kept
 * history on while its camera moved.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const callers = sources(join(__dirname, "../src")).filter((path) => /new AsciiPass\(/.test(readFileSync(path, "utf8")));

describe("ASCII pass callers", () => {
  it("finds the callers", () => {
    const names = callers.map((path) => path.split(/[\\/]/).pop());
    expect(names).toEqual(expect.arrayContaining(["AsciiWorld.js", "Diorama.js", "SiteScene.js"]));
  });

  it.each(callers.map((path) => [path.split(/[\\/]src[\\/]/).pop(), path]))(
    "%s passes its camera to every render",
    (_name, path) => {
      const text = readFileSync(path as string, "utf8");
      const calls = [...text.matchAll(/\bascii\.render\(([^)]*)\)/g)].map((m) => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args.split(",").map((a) => a.trim()).filter(Boolean)).toHaveLength(2);
    },
  );
});
