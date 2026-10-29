import { defineConfig } from 'vitest/config';

/* Unit tests for the app's own logic (input, render loop lifecycle). They
   run in Node with react-native, expo-gl and three mocked per test. */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
