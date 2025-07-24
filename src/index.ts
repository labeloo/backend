import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { drizzle } from 'drizzle-orm/libsql/node';

import type { Variables } from './types';
import api from './modules/index';

const app = new Hono<{ Variables: Variables }>();

app.use('*', cors());

app.use('*', async (c, next) => {
    const db = drizzle('file:database.db');

    const result = await db.run('select 1');
    const health = result.rows[0][0] === 1;
    if (!health) {
        return c.json({ error: 'Database is not healthy' }, 500);
    }

    c.set('db', db);
    return next();
});

app.get('/', (c) => c.text('Hello!'));

app.post('/query', async (c) => {
    try {
        const db = c.var.db;
        const { query } = await c.req.json();
        const result = await db.run(query);
        return c.json(result);
 
    } catch (error) {
        console.error('Error executing query:', error);
        return c.json({ error: 'Failed to execute query', message: error.message }, 500);
    }
});

app.route('/api', api);

serve({
    fetch: app.fetch,
    port: 8787,
}).on("listening", () => {
    console.log("Server is running on http://localhost:8787");
}).on("close", () => {
    console.log("Server is closed");
});
