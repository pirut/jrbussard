// npm run login [-- --consent]
// Sign in with ChatGPT in the system browser; saves credentials 0600.

import { spawn } from "node:child_process";
import { login } from "../auth/login.ts";
import { CallbackError } from "../auth/oauth.ts";
import { errorMessage } from "../log.ts";
import { credentialManager } from "../mind.ts";
import { paths } from "../paths.ts";
import { parseArgs } from "./args.ts";

function openInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    // The URL goes to `open` as an argument, never to a log.
    const child = spawn("open", [url], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const credentials = credentialManager();
  console.log("Continue with ChatGPT: opening your browser to sign in...");
  try {
    const result = await login({
      credentials,
      hostFile: paths.host(),
      promptConsent: flags.consent === true,
      openBrowser: async (url, redacted) => {
        if (!(await openInBrowser(url))) {
          console.log("Could not open a browser. Open this URL on this Mac:");
          console.log(redacted());
        }
        console.log("Waiting for the sign-in to finish (Ctrl-C to cancel)...");
      },
    });
    console.log(`Signed in${result.email ? ` as ${result.email}` : ""}.`);
    if (result.planScope) {
      if (result.firstSignIn) {
        console.log("\nYou're using your ChatGPT plan.");
        console.log("The nest's AI requests from this Mac mini now use your ChatGPT plan.");
        console.log("Manage usage and this app's access: https://chatgpt.com/settings/usage\n");
      } else {
        console.log("ChatGPT plan use: enabled.");
      }
    } else {
      console.log("\nChatGPT plan use was NOT granted, so the mind will not make plan calls.");
      console.log("To enable it: npm run login -- --consent");
      console.log("Or use an API key instead: put OPENAI_API_KEY in the mind's env file and run");
      console.log("  npm run setup -- --provider openai-api   (see docs/nest-setup.md)");
    }
    console.log("A running `npm start` picks up the new sign-in on its next request.");
    process.exit(0);
  } catch (err) {
    if (err instanceof CallbackError && err.kind === "access_denied") {
      console.error("Sign-in was declined. Nothing was saved. Run `npm run login` to try again.");
    } else {
      console.error(`Sign-in failed: ${errorMessage(err)}`);
    }
    process.exit(1);
  }
}

void main();
