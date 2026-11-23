import os from "node:os";
import path from "node:path";

/**
 * Everything the mind keeps lives in one owner-only directory.
 * NEST_MIND_HOME overrides it (tests and the selftest use a temp dir).
 */
export function mindHome(): string {
  return (
    process.env.NEST_MIND_HOME ??
    path.join(os.homedir(), "Library", "Application Support", "nest-mind")
  );
}

export const paths = {
  home: () => mindHome(),
  config: () => path.join(mindHome(), "config.json"),
  credentials: () => path.join(mindHome(), "credentials.json"),
  credentialsLock: () => path.join(mindHome(), "credentials.lock"),
  host: () => path.join(mindHome(), "host.json"),
  env: () => path.join(mindHome(), "nest-mind.env"),
  state: () => path.join(mindHome(), "state.json"),
  backups: () => path.join(mindHome(), "backups"),
  logs: () => path.join(os.homedir(), "Library", "Logs", "nest-mind"),
};
