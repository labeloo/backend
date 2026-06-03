import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/libsql/node';

import type { Variables } from './types';
import api from './modules/index';
import { DATABASE_URL } from './config';

const app = new Hono<{ Variables: Variables }>();

app.use(
    '/api/auth/login',
    cors({
        origin: [
            'http://192.168.1.8:3000',
            'http://localhost:3000',
            'http://0.0.0.0:3000',
        ],
        credentials: true,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
    })
);

app.use(
    '*',
    cors({
        origin: [
            'http://192.168.1.8:3000',
            'http://localhost:3000',
            'http://0.0.0.0:3000',
        ],
        credentials: true,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['*'],
    })
);

app.use('*', async (c, next) => {
    const db = drizzle(DATABASE_URL);

    const result = await db.run('select 1');
    const health = result.rows[0][0] === 1;
    if (!health) {
        return c.json({ error: 'Database is not healthy' }, 500);
    }

    c.set('db', db);
    return next();
});

app.get('/', (c) => c.text('Hello!'));

app.route('/api', api);

// Only bind the HTTP port when run directly. Tests import `app` and drive it
// via app.request() without starting a real server.
if (process.env.NODE_ENV !== 'test') {
    serve({
        fetch: app.fetch,
        port: 8787,
    })
        .on('listening', () => {
            console.log('Server is running on http://localhost:8787');
        })
        .on('close', () => {
            console.log('Server is closed');
        });
}

export default app;
