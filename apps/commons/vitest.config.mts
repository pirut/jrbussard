import path from 'node:path';
import { defineConfig } from 'vitest/config';

/*
 * Unit tests for the app's own logic (input, walking, HUD data, render loop
 * lifecycle). They run in Node with react-native, expo-gl and three mocked
 * per test.
 *
 * The aliases mirror tsconfig `paths`, which Metro reads in the app: without
 * them the shared browser modules (`@site/…`) wouldn't resolve here.
 */
const repo = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@site': path.join(repo, 'src'),
      '@convex': path.join(repo, 'convex'),
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
