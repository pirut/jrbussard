import http from "node:http";
import type { AddressInfo } from "node:net";
import { CALLBACK_HOST, CALLBACK_PATH, redirectUriFor } from "./oauth.ts";

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:4rem auto;line-height:1.5">` +
  `<h1 style="font-weight:600">${title}</h1><p>${body}</p></body>`;

export type CallbackServer = {
  redirectUri: string;
  /** Resolves with the first request to the callback path that carries the expected state (when one is given). */
  wait(): Promise<URL>;
  close(): Promise<void>;
};

/**
 * Loopback listener on 127.0.0.1 (never `localhost`). Start it before
 * opening the browser. Only GET on the exact callback path is handled.
 */
export async function startCallbackServer(opts: { port: number; timeoutMs?: number; state?: string }): Promise<CallbackServer> {
  let resolveUrl!: (u: URL) => void;
  let rejectUrl!: (e: Error) => void;
  const got = new Promise<URL>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  let settled = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${CALLBACK_HOST}`);
    if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    // Any other page can send a GET to this port. A request that does not
    // carry this attempt's state is not the browser coming back from
    // sign-in: refuse it and keep listening for the real one.
    if (opts.state !== undefined && url.searchParams.get("state") !== opts.state) {
      res
        .writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" })
        .end(PAGE("Not this sign-in", "This request does not belong to the sign-in nest-mind is waiting for. It was ignored."));
      return;
    }
    const ok = url.searchParams.has("code") && !url.searchParams.has("error");
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" })
      .end(ok ? PAGE("Signed in", "nest-mind received the sign-in. You can close this tab and return to the terminal.") : PAGE("Sign-in not completed", "Return to the terminal for details."));
    if (!settled) {
      settled = true;
      resolveUrl(url);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, CALLBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectUrl(new Error("Timed out waiting for the browser sign-in."));
    }
  }, opts.timeoutMs ?? 10 * 60_000);

  return {
    redirectUri: redirectUriFor(port),
    wait: () => got,
    close: async () => {
      clearTimeout(timer);
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
