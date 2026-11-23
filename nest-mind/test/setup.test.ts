import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/setup.ts";

const LEGACY_DEV_SECRET = "legacy-dev-secret-from-before-per-deployment-secrets";
const DEV_URL = "https://dev-otter-1.convex.cloud";
const PROD_URL = "https://prod-otter-2.convex.cloud";

describe("setup: legacy config moved to a different deployment", () => {
  let home: string;
  let savedHome: string | undefined;
  let logs: string[];

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "nest-mind-setup-"));
    savedHome = process.env.NEST_MIND_HOME;
    process.env.NEST_MIND_HOME = home;
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A pre-per-deployment config: one mindSecret, no secrets map, pointed at dev.
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ mindId: "macmini-test", provider: "auto", convexUrl: DEV_URL, mindSecret: LEGACY_DEV_SECRET }),
      { mode: 0o600 },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHome === undefined) delete process.env.NEST_MIND_HOME;
    else process.env.NEST_MIND_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("generates a new secret for prod instead of filing the dev secret under prod", async () => {
    await main(["--convex-url", PROD_URL, "--skip-convex"]);

    const saved = JSON.parse(readFileSync(path.join(home, "config.json"), "utf8")) as {
      convexUrl: string;
      mindSecret: string;
      secrets: Record<string, string>;
    };
    expect(saved.convexUrl).toBe(PROD_URL);
    // The new secret is for prod: it is not the dev secret, and it is the active one.
    expect(saved.mindSecret).not.toBe(LEGACY_DEV_SECRET);
    expect(saved.mindSecret.length).toBeGreaterThan(20);
    expect(saved.secrets["prod-otter-2"]).toBe(saved.mindSecret);
    // The legacy secret is adopted for the dev deployment it was created for, and only there.
    expect(saved.secrets["dev-otter-1"]).toBe(LEGACY_DEV_SECRET);
    // isNew: the secret must be pushed to prod (setup prints the skip line only when isNew is true).
    expect(logs.some((l) => l.includes("Skipped setting NEST_MIND_SECRET"))).toBe(true);
    expect(logs.some((l) => l.includes(LEGACY_DEV_SECRET))).toBe(false);
  });
});
