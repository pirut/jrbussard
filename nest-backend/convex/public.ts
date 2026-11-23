// The only unauthenticated read: has this nest been claimed?
import { query } from './_generated/server';

export const status = query({
  args: {},
  handler: async (ctx) => ({ claimed: !!(await ctx.db.query('passkeys').first()) }),
});
