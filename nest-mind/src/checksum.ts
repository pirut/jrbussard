import { createHash } from "node:crypto";

/**
 * Port of `canonicalJson` in nest-backend/convex/engine/sha256.ts: JSON with
 * sorted object keys, `undefined` object fields dropped and `undefined`
 * (or a top-level undefined) written as null. The export checksum must match
 * the backend's byte for byte, so keep the two in step.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v === undefined ? null : v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** SHA-256 of the UTF-8 bytes, lowercase hex (same as the backend's `sha256Hex`). */
export const sha256Hex = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");
