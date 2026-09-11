/* Keep the prayer backend deployment separate from the Commons game backend. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const prayerKey = process.env.PRAYER_CONVEX_DEPLOY_KEY;
const executable = process.execPath;
let result;
if (prayerKey) {
  const env = { ...process.env, CONVEX_DEPLOY_KEY: prayerKey };
  // A root/site Convex link belongs to the game, never to Together.
  delete env.CONVEX_DEPLOYMENT;
  result = spawnSync(executable, [
    path.join(root, 'node_modules/convex/bin/main.js'), 'deploy',
    '--cmd', 'npm --prefix .. run build:frontend',
    '--cmd-url-env-var-name', 'REACT_APP_PRAYER_CONVEX_URL',
  ], { cwd: path.join(root, 'prayer-backend'), env, stdio: 'inherit' });
} else {
  result = spawnSync(executable, [path.join(root, 'node_modules/react-scripts/bin/react-scripts.js'), 'build'], {
    cwd: root, env: process.env, stdio: 'inherit',
  });
}
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
