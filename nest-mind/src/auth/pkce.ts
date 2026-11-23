import { createHash, randomBytes, randomUUID } from "node:crypto";

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 verifier: 32 random bytes → 43 base64url chars. */
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 challenge: base64url(SHA-256(verifier)), no padding. */
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export type AuthAttempt = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
};

/** Fresh state, nonce and PKCE values for one authorization attempt. */
export function newAttempt(): AuthAttempt {
  const verifier = createVerifier();
  return { state: randomToken(), nonce: randomToken(), verifier, challenge: challengeFor(verifier) };
}

/** A stable, opaque per-host id (`urn:uuid:` form, UUIDv4). */
export function newHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}
