import { drizzle } from 'drizzle-orm/d1';

import { createApp } from './app';
import { R2Storage, type R2Bucket } from './storage';
import type { Variables } from './types';

/**
 * The hosted entry point: same app, D1 instead of a file, R2 instead of a disk.
 *
 * A Worker has no long-lived process, so the database handle is built per
 * request from the binding rather than once at module scope.
 */
export interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    CORS_ORIGINS?: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const origins = (env.CORS_ORIGINS || '')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);

        const app = createApp(
            drizzle(env.DB) as unknown as Variables['db'],
            new R2Storage(env.BUCKET),
            origins.length ? origins : ['*']
        );
        return app.fetch(request, env as unknown as Record<string, unknown>, ctx);
    },
};
