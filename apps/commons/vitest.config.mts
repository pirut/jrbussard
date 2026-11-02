import path from 'node:path';
import { defineConfig } from 'vitest/config';

/* Unit tests for the app's own logic (input, render loop lifecycle). They
   run in Node with react-native, expo-gl and three mocked per test. */
export default defineConfig({
  /* The modules shared with the browser game, as tsconfig and Metro see them. */
  resolve: { alias: { '@site': path.resolve(__dirname, '../../src') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
