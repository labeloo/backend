import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // JWT_SECRET is required at config-import time; provide one for tests.
        // DATABASE_URL is set per-test to an isolated temp file.
        env: {
            JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod',
        },
        include: ['test/**/*.test.ts'],
        // Each test file uses its own temp DB; keep files serial to avoid any
        // shared-resource surprises and noisy output interleaving.
        fileParallelism: false,
        testTimeout: 20000,
        hookTimeout: 20000,
    },
});
