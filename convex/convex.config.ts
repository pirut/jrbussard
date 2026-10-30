import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

/*
 * Convex app definition: installs the rate-limiter component, which keeps its
 * own isolated tables (its state is not in schema.ts) and is reached in code
 * as `components.rateLimiter` (see the RateLimiter instance in game.ts). Components must be listed here to exist; adding one needs a
 * `npx convex dev` / deploy to regenerate convex/_generated.
 */

const app = defineApp();
app.use(rateLimiter);
export default app;
