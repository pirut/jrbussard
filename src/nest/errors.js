/* Backend errors are ConvexError with data = { code, message }; rate limits
   carry data.kind === 'RateLimited'. Everything else is a network or server
   failure, which we describe gently. */

export function errorCode(e) {
  const d = e?.data;
  if (d && typeof d === 'object') {
    if (d.kind === 'RateLimited') return 'rate_limited';
    if (typeof d.code === 'string') return d.code;
  }
  return null;
}

export function errorText(e, fallback = 'Something went quiet. Try again in a moment.') {
  const code = errorCode(e);
  if (code === 'rate_limited') return 'A little too fast. Give it a moment.';
  if (code === 'unauthenticated') return 'Please sign in again.';
  if (code && typeof e?.data?.message === 'string' && e.data.message) return e.data.message;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You are offline. The nest is still here.';
  return fallback;
}

export function isUnauthenticated(e) {
  return errorCode(e) === 'unauthenticated';
}
