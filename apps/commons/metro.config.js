// Metro, taught to reach outside apps/commons for the modules the app
// shares with the browser game (src/lib, src/world, src/arcade/ascii3d) and
// the Convex function names. Only those two folders are watched: watching
// the repo root would crawl its node_modules.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.join(repoRoot, 'src'), path.join(repoRoot, 'convex')];
// A package imported by a shared file (none are, today) must come from the
// app's node_modules, never the root's React 18 / CRA install: resolve it as
// if the app had asked.
const inApp = (file) => file.startsWith(projectRoot + path.sep);
const bare = (name) => !name.startsWith('.') && !path.isAbsolute(name);
const appOrigin = path.join(projectRoot, 'index.ts');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (bare(moduleName) && !inApp(context.originModulePath)) {
    return context.resolveRequest({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
