import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SECRET_FILE_MODE = 0o600;
export const SECRET_DIR_MODE = 0o700;

export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: SECRET_DIR_MODE });
  const st = await fs.stat(dir);
  if ((st.mode & 0o077) !== 0) await fs.chmod(dir, SECRET_DIR_MODE);
}

/**
 * Write a file atomically with owner-only permissions: write a unique temp
 * file in the same directory (created 0600, so it is never readable by
 * others even for an instant), fsync it, then rename over the target.
 * A crash leaves either the old file or the new one, never a torn one.
 */
export async function writeFileAtomic(
  file: string,
  data: string,
  mode: number = SECRET_FILE_MODE,
): Promise<void> {
  const dir = path.dirname(file);
  await ensurePrivateDir(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await fs.open(tmp, "wx", mode);
  try {
    await handle.writeFile(data, "utf8");
    await handle.chmod(mode); // umask can strip bits from open(); chmod is exact
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Read a JSON file; undefined if missing. Tightens loose permissions. */
export async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const st = await fs.stat(file);
    if ((st.mode & 0o077) !== 0) await fs.chmod(file, SECRET_FILE_MODE);
  } catch {
    // best effort
  }
  return JSON.parse(text) as T;
}

export async function fileMtimeMs(file: string): Promise<number | undefined> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function readLockToken(lockFile: string): Promise<string | undefined> {
  try {
    return await fs.readFile(lockFile, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Remove a lock whose holder looks dead. Takeovers are serialized through a
 * second O_EXCL file (`<lock>.takeover`), and inside it the lock is judged
 * again (still older than `staleMs`, still the token we saw) before it is
 * removed. Without that, two waiters that both saw the same stale lock
 * would each delete "it", the second one deleting the lock the first had
 * just taken. Returns false when another waiter is already doing the takeover.
 */
async function takeOverStale(lockFile: string, seenToken: string | undefined, staleMs: number): Promise<boolean> {
  const gate = `${lockFile}.takeover`;
  try {
    const h = await fs.open(gate, "wx", SECRET_FILE_MODE);
    await h.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const gateMtime = await fileMtimeMs(gate);
    // A taker that died mid-takeover must not wedge the lock forever.
    if (gateMtime !== undefined && Date.now() - gateMtime > staleMs) await fs.rm(gate, { force: true });
    return false;
  }
  try {
    const mtime = await fileMtimeMs(lockFile);
    if (mtime !== undefined && Date.now() - mtime > staleMs && (await readLockToken(lockFile)) === seenToken) {
      await fs.rm(lockFile, { force: true });
    }
  } finally {
    await fs.rm(gate, { force: true });
  }
  return true;
}

/**
 * A small cross-process lock (O_EXCL lock file). Serializes refreshes,
 * logins and logouts between `npm start` and a concurrent `npm run status`
 * or `npm run login`, because refresh tokens rotate and a second refresh
 * with the old token would fail.
 *
 * The file holds a unique token. The holder keeps its mtime fresh while it
 * works, a lock is only taken over (one waiter at a time) when its mtime is
 * older than `staleMs` (its holder died), and release only removes the file
 * if it still holds our token, so a slow holder can never delete the lock of
 * whoever took over.
 */
export async function withFileLock<T>(
  lockFile: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const staleMs = opts.staleMs ?? 60_000;
  const start = Date.now();
  const token = `${process.pid}.${randomBytes(8).toString("hex")}`;
  await ensurePrivateDir(path.dirname(lockFile));
  for (;;) {
    try {
      const h = await fs.open(lockFile, "wx", SECRET_FILE_MODE);
      try {
        await h.writeFile(token);
      } finally {
        await h.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const mtime = await fileMtimeMs(lockFile);
      if (mtime !== undefined && Date.now() - mtime > staleMs) {
        if (await takeOverStale(lockFile, await readLockToken(lockFile), staleMs)) continue;
      }
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for the credentials lock");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // A long job (a revoke with retries) must not look stale to a waiter.
  const keepAlive = setInterval(() => {
    void (async () => {
      if ((await readLockToken(lockFile)) !== token) return;
      const now = new Date();
      await fs.utimes(lockFile, now, now);
    })().catch(() => undefined);
  }, Math.max(10, Math.floor(staleMs / 3)));
  keepAlive.unref();
  try {
    return await fn();
  } finally {
    clearInterval(keepAlive);
    if ((await readLockToken(lockFile)) === token) await fs.rm(lockFile, { force: true });
  }
}
