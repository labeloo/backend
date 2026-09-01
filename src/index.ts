import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/libsql/node';

import { createApp } from './app';
import { DiskStorage } from './storage';
import { CORS_ORIGINS, DATABASE_URL, HOST, PORT } from './config';

/**
 * The self-hosted entry point: one process, one file for the database, one
 * directory for the bucket. This is the path `docker compose up` takes.
 */
const app = createApp(drizzle(DATABASE_URL), new DiskStorage('./bucket'));

serve({ fetch: app.fetch, port: PORT, hostname: HOST })
    .on('listening', () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
        console.log(`Database: ${DATABASE_URL}`);
        console.log(`CORS origins: ${CORS_ORIGINS.join(', ')}`);
    })
    .on('close', () => console.log('Server is closed'));
