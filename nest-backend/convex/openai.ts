// Optional cloud fallback: the Responses API with OPENAI_API_KEY (separate API billing).
// Runs only when that env var is set and settings allow it. Output goes through the same validator.
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { MindRequest } from './engine/prompt';

const MODELS = {
  fast: () => process.env.NEST_OPENAI_FAST_MODEL || 'gpt-5-mini',
  deep: () => process.env.NEST_OPENAI_DEEP_MODEL || 'gpt-5',
};

function outputText(body: any): string {
  if (typeof body?.output_text === 'string') return body.output_text;
  const parts: string[] = [];
  for (const item of body?.output ?? []) for (const c of item?.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  return parts.join('');
}

export const run = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, { jobId }): Promise<void> => {
    const key = process.env.OPENAI_API_KEY;
    const job: { kind: string; request: unknown } | null = await ctx.runQuery(internal.jobs.getForApi, { jobId });
    if (!job) return;
    if (!key) { await ctx.runMutation(internal.jobs.apiFail, { jobId, error: 'OPENAI_API_KEY is not set' }); return; }
    const req = job.request as MindRequest;
    const model = MODELS[req.tier]();
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          instructions: req.instructions,
          input: req.input,
          store: false,
          text: { format: { type: 'json_schema', name: req.schemaName, schema: req.jsonSchema, strict: true } },
        }),
        signal: AbortSignal.timeout(req.tier === 'fast' ? 25_000 : 240_000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
        await ctx.runMutation(internal.jobs.apiFail, { jobId, error: `openai ${res.status}: ${detail}` });
        return;
      }
      const body = await res.json();
      await ctx.runMutation(internal.jobs.apiComplete, { jobId, outputText: outputText(body), model: String(body?.model ?? model), usage: body?.usage ?? undefined });
    } catch (e) {
      await ctx.runMutation(internal.jobs.apiFail, { jobId, error: `openai request failed: ${String((e as Error).message).slice(0, 160)}` });
    }
  },
});
