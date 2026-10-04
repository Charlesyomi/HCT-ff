import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    esbuild: {
        jsx: 'automatic',
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('.', import.meta.url)),
        },
    },
    test: {
        // Playwright owns e2e/*.spec.ts. Without this, vitest's default `**/*.spec.ts`
        // include collects those files and the whole unit run fails on a runner it cannot
        // execute (the tests themselves never load).
        exclude: ['e2e/**', 'node_modules/**', '.next/**', 'test-results/**'],
    },
});
