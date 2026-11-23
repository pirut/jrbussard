import { readFileSync } from "node:fs";
import { CredentialManager } from "./auth/credentials.ts";
import type { MindConfig, ProviderMode } from "./config.ts";
import { paths } from "./paths.ts";
import { ChatGptPlanProvider } from "./providers/chatgptPlan.ts";
import { FakeProvider } from "./providers/fake.ts";
import { OpenAiApiProvider } from "./providers/openaiApi.ts";
import { ProviderRouter } from "./providers/router.ts";

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

export function credentialManager(): CredentialManager {
  return new CredentialManager({ file: paths.credentials(), lockFile: paths.credentialsLock() });
}

export function buildRouter(opts: {
  config: MindConfig;
  env: Record<string, string>;
  credentials?: CredentialManager;
  mode?: ProviderMode;
}): { router: ProviderRouter; plan: ChatGptPlanProvider; api: OpenAiApiProvider } {
  const credentials = opts.credentials ?? credentialManager();
  const plan = new ChatGptPlanProvider({ credentials, models: opts.config.models });
  const api = new OpenAiApiProvider({ apiKey: opts.env.OPENAI_API_KEY || undefined, models: opts.config.apiModels });
  const router = new ProviderRouter(opts.mode ?? opts.config.provider, { plan, api, fake: new FakeProvider() });
  return { router, plan, api };
}
