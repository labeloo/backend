import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { Variables } from './types';
import type { Storage } from './storage';
import api from './modules/index';
import { CORS_HEADERS, CORS_ORIGINS } from './config';

/**
 * Everything the API is, minus where it runs.
 *
 * The two entry points differ only in what they hand in here: on a machine it is
 * libsql plus a directory, on Cloudflare it is D1 plus an R2 bucket. Keeping the
 * routes ignorant of that difference is what lets one codebase serve both a
 * self-hosted install and the hosted service without a fork.
 */
export const createApp = (db: Variables['db'], storage: Storage, corsOrigins: string[] = CORS_ORIGINS) => {
    const app = new Hono<{ Variables: Variables }>();

    const corsOptions = {
        origin: corsOrigins,
        credentials: true,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: CORS_HEADERS,
    };

    app.use('/api/auth/login', cors(corsOptions));
    app.use('*', cors(corsOptions));

    app.use('*', async (c, next) => {
        c.set('db', db);
        c.set('storage', storage);
        return next();
    });

    app.get('/', (c) => c.text('Hello!'));

    // Liveness + database probe. Used by Docker healthchecks and by the Worker's
    // own smoke test after a deploy.
    app.get('/health', async (c) => {
        try {
            await db.run('select 1' as never);
            return c.json({
                status: 'ok', database: 'ok', disk: storage.hasLocalDisk,
                now: Date.now(), iso: new Date().toISOString(),
            });
        } catch (error: any) {
            return c.json({ status: 'error', message: error?.message }, 503);
        }
    });

    app.route('/api', api);
    return app;
};
