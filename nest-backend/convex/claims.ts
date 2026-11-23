// Minting claim links and NFC tag secrets. Actions, so randomness is real (not seeded).
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { fail, hashCode, hashTagSecret } from './lib/core';

export function randomCode(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const BASE32 = 'abcdefghijkmnpqrstuvwxyz23456789';
export function randomTagId(len = 12): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => BASE32[b % BASE32.length]).join('');
}

export function siteBase(base?: string): string {
  const b = base ?? process.env.NEST_SITE_URL ?? (process.env.NEST_ORIGINS ?? '').split(',')[0]?.trim() ?? '';
  return b.replace(/\/+$/, '') || 'http://localhost:3000';
}

/** CLI only (npx convex run): `npm run claim` calls this. */
export const mintClaim = internalAction({
  args: { purpose: v.union(v.literal('owner'), v.literal('device')), base: v.optional(v.string()) },
  handler: async (ctx, { purpose, base }): Promise<{ url: string; purpose: 'owner' | 'device'; expiresAt: number }> => {
    const code = randomCode();
    const { expiresAt }: { expiresAt: number } = await ctx.runMutation(internal.auth.storeClaim, { codeHash: hashCode(code), purpose });
    return { url: `${siteBase(base)}/nest/claim#${code}`, purpose, expiresAt };
  },
});

/** Signed-in owner adds another device from settings. */
export const mintDeviceLink = action({
  args: { sessionToken: v.string(), base: v.optional(v.string()) },
  handler: async (ctx, { sessionToken, base }): Promise<{ url: string; expiresAt: number }> => {
    if (!(await ctx.runQuery(internal.auth.checkSession, { sessionToken }))) fail('Please sign in.', 'unauthenticated');
    const code = randomCode();
    const { expiresAt }: { expiresAt: number } = await ctx.runMutation(internal.auth.storeClaim, { codeHash: hashCode(code), purpose: 'device' });
    return { url: `${siteBase(base)}/nest/claim#${code}`, expiresAt };
  },
});

/** Signed-in owner creates an NFC tag URL. The secret is shown once; only its hash is kept. */
export const createTag = action({
  args: { sessionToken: v.string(), label: v.string(), base: v.optional(v.string()) },
  handler: async (ctx, { sessionToken, label, base }): Promise<{ tagId: string; url: string }> => {
    if (!(await ctx.runQuery(internal.auth.checkSession, { sessionToken }))) fail('Please sign in.', 'unauthenticated');
    const tagId = randomTagId();
    const secret = randomCode(24);
    await ctx.runMutation(internal.touch.storeTag, { tagId, secretHash: hashTagSecret(tagId, secret), label });
    return { tagId, url: `${siteBase(base)}/nest/touch/${tagId}#${secret}` };
  },
});

/** CLI: `npm run tag` → first tag before any session exists. */
export const mintTag = internalAction({
  args: { label: v.string(), base: v.optional(v.string()) },
  handler: async (ctx, { label, base }): Promise<{ tagId: string; url: string }> => {
    const tagId = randomTagId();
    const secret = randomCode(24);
    await ctx.runMutation(internal.touch.storeTag, { tagId, secretHash: hashTagSecret(tagId, secret), label });
    return { tagId, url: `${siteBase(base)}/nest/touch/${tagId}#${secret}` };
  },
});
