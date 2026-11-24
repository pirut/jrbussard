// npm run logout: revoke the ChatGPT session and clear tokens locally.

import { logout } from "../auth/logout.ts";
import { errorMessage } from "../log.ts";
import { credentialManager } from "../mind.ts";

async function main() {
  try {
    const r = await logout({ credentials: credentialManager() });
    if (!r.wasSignedIn) {
      console.log("Not signed in. Nothing to revoke.");
    } else if (r.revoked) {
      console.log("Signed out. The ChatGPT session was revoked and local tokens were cleared.");
    } else {
      console.log("Signed out locally (tokens cleared), but remote revocation was NOT confirmed" + (r.detail ? ` (${r.detail})` : "") + ".");
      console.log("To be sure, disconnect the app in ChatGPT Settings: https://chatgpt.com/settings");
    }
    console.log("The registration (client id) and this host's id are kept for the next `npm run login`.");
  } catch (err) {
    console.error(`Sign-out failed: ${errorMessage(err)}`);
    process.exit(1);
  }
}

void main();
