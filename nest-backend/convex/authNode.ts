'use node';
// The WebAuthn ceremony (passkeys, Face ID) with @simplewebauthn/server.
import { v } from 'convex/values';
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { fail, hashToken } from './lib/core';

function rp() {
  const rpID = process.env.NEST_RP_ID;
  const origins = (process.env.NEST_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!rpID || !origins.length) fail('Passkeys are not configured on this deployment (NEST_RP_ID, NEST_ORIGINS).', 'misconfigured');
  return { rpID, origins };
}

type Passkey = { credentialId: string; publicKey: string; counter: number; transports: string[] };
const b64url = (buf: Uint8Array) => Buffer.from(buf).toString('base64url');
const newToken = () => b64url(randomBytes(32));

/** Step 1 of claiming: check the claim code, return passkey creation options. */
export const registrationOptions = action({
  args: { claimCode: v.string() },
  handler: async (ctx, { claimCode }): Promise<{ challengeId: string; options: unknown; purpose: 'owner' | 'device' }> => {
    const { rpID } = rp();
    await ctx.runMutation(internal.auth.consumeAuthToken, {});
    const claim: { purpose: 'owner' | 'device'; expiresAt: number } | null = await ctx.runQuery(internal.auth.checkClaim, { code: claimCode });
    if (!claim) fail('This claim link has expired or was already used.', 'expired');
    const existing: Passkey[] = await ctx.runQuery(internal.auth.listPasskeysInternal, {});
    const options = await generateRegistrationOptions({
      rpName: 'The Nest', rpID, userName: 'owner', userDisplayName: 'Owner', userID: new TextEncoder().encode('nest-owner'),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    });
    const challengeId: string = await ctx.runMutation(internal.auth.storeChallenge, { challenge: options.challenge, kind: 'register', claimCode });
    return { challengeId, options, purpose: claim.purpose };
  },
});

/** Step 2 of claiming: verify the new passkey, consume the link, return a session token. */
export const register = action({
  args: { claimCode: v.string(), challengeId: v.string(), response: v.any(), label: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ sessionToken: string; purpose: 'owner' | 'device' }> => {
    const { rpID, origins } = rp();
    await ctx.runMutation(internal.auth.consumeAuthToken, {});
    const ch = await ctx.runQuery(internal.auth.getChallenge, { challengeId: a.challengeId });
    if (!ch || ch.kind !== 'register') fail('This sign-in attempt expired. Try again.', 'expired');
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: a.response, expectedChallenge: ch.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
    } catch (e) {
      await ctx.runMutation(internal.auth.failedAttempt, { reason: 'register: ' + String((e as Error).message).slice(0, 120) });
      fail('That passkey could not be verified.', 'unauthenticated');
    }
    if (!verification.verified || !verification.registrationInfo) fail('That passkey could not be verified.', 'unauthenticated');
    const cred = verification.registrationInfo.credential;
    const sessionToken = newToken();
    const { purpose } = await ctx.runMutation(internal.auth.finishRegistration, {
      challengeId: ch._id as Id<'authChallenges'>, claimCode: a.claimCode, tokenHash: hashToken(sessionToken), seed: b64url(randomBytes(16)),
      credentialId: cred.id, publicKey: b64url(cred.publicKey), counter: cred.counter, transports: (cred.transports ?? []) as string[],
      label: (a.label ?? 'iPhone').slice(0, 60),
    });
    return { sessionToken, purpose };
  },
});

export const loginOptions = action({
  args: {},
  handler: async (ctx): Promise<{ challengeId: string; options: unknown }> => {
    const { rpID } = rp();
    await ctx.runMutation(internal.auth.consumeAuthToken, {});
    const passkeys: Passkey[] = await ctx.runQuery(internal.auth.listPasskeysInternal, {});
    if (!passkeys.length) fail('This nest has not been claimed yet.', 'unclaimed');
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as never })) });
    const challengeId: string = await ctx.runMutation(internal.auth.storeChallenge, { challenge: options.challenge, kind: 'login' });
    return { challengeId, options };
  },
});

export const login = action({
  args: { challengeId: v.string(), response: v.any(), label: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ sessionToken: string }> => {
    const { rpID, origins } = rp();
    await ctx.runMutation(internal.auth.consumeAuthToken, {});
    const ch = await ctx.runQuery(internal.auth.getChallenge, { challengeId: a.challengeId });
    if (!ch || ch.kind !== 'login') fail('This sign-in attempt expired. Try again.', 'expired');
    const passkeys: Passkey[] = await ctx.runQuery(internal.auth.listPasskeysInternal, {});
    const pk = passkeys.find((p) => p.credentialId === a.response?.id);
    if (!pk) {
      await ctx.runMutation(internal.auth.failedAttempt, { reason: 'login: unknown credential' });
      fail('Unknown passkey.', 'unauthenticated');
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: a.response, expectedChallenge: ch.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: pk.credentialId, publicKey: new Uint8Array(Buffer.from(pk.publicKey, 'base64url')), counter: pk.counter, transports: pk.transports as never },
      });
    } catch (e) {
      await ctx.runMutation(internal.auth.failedAttempt, { reason: 'login: ' + String((e as Error).message).slice(0, 120) });
      fail('That passkey could not be verified.', 'unauthenticated');
    }
    if (!verification.verified) fail('That passkey could not be verified.', 'unauthenticated');
    const sessionToken = newToken();
    await ctx.runMutation(internal.auth.finishLogin, {
      challengeId: ch._id as Id<'authChallenges'>, credentialId: pk.credentialId, newCounter: verification.authenticationInfo.newCounter,
      tokenHash: hashToken(sessionToken), label: (a.label ?? 'iPhone').slice(0, 60),
    });
    return { sessionToken };
  },
});
