import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import type { Variables } from '../src/types';
import { createTestDb, seedUser, type TestDb } from './helpers';

const OWNER_EMAIL = 'owner@test.com';
const OWNER_PASSWORD = 'correct-horse-battery-staple';

let testDb: TestDb;
let app: Hono<{ Variables: Variables }>;

beforeAll(async () => {
    testDb = await createTestDb();
    // The app's DB middleware reads DATABASE_URL at request time, so point it
    // at our isolated temp database before the app is imported.
    process.env.DATABASE_URL = testDb.url;
    await seedUser(testDb.client, OWNER_EMAIL, OWNER_PASSWORD);
    // Import only after env is set: the app wires to our temp DB + test secret.
    app = (await import('../src/index')).default;
});

afterAll(() => {
    testDb.cleanup();
});

function login(email: string, password: string) {
    return app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
}

describe('A1: the raw-SQL /query endpoint is gone', () => {
    it('responds 404 to POST /query', async () => {
        const res = await app.request('/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'SELECT 1' }),
        });
        expect(res.status).toBe(404);
    });

    it('a DROP TABLE payload to /query does NOT execute', async () => {
        await app.request('/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'DROP TABLE users;' }),
        });
        // The users table (and our seeded owner) must survive.
        const r = await testDb.client.execute(
            'SELECT COUNT(*) AS n FROM users'
        );
        expect(Number(r.rows[0].n)).toBeGreaterThan(0);
    });
});

describe('A2: JWT secret is centralized and consistent', () => {
    it('rejects a protected route with no token (401)', async () => {
        const res = await app.request('/api');
        expect(res.status).toBe(401);
    });

    it('accepts a token from the login path — sign & verify share one secret', async () => {
        const loginRes = await login(OWNER_EMAIL, OWNER_PASSWORD);
        expect(loginRes.status).toBe(200);
        const { token } = (await loginRes.json()) as { token: string };
        expect(typeof token).toBe('string');

        const res = await app.request('/api', {
            headers: { Authorization: `Bearer ${token}` },
        });
        // Under the original bug (login signed with env secret, middleware
        // verified with the literal 'honoiscool'), this would be 401.
        expect(res.status).toBe(200);
        const payload = (await res.json()) as { email: string };
        expect(payload.email).toBe(OWNER_EMAIL);
    });

    it('rejects a token signed with the wrong secret (401)', async () => {
        const { sign } = await import('hono/jwt');
        const forged = await sign(
            {
                userId: 1,
                email: OWNER_EMAIL,
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
            'totally-wrong-secret'
        );
        const res = await app.request('/api', {
            headers: { Authorization: `Bearer ${forged}` },
        });
        expect(res.status).toBe(401);
    });

    it('config refuses to load when JWT_SECRET is missing', async () => {
        vi.resetModules();
        const saved = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;
        await expect(import('../src/config')).rejects.toThrow(/JWT_SECRET/);
        process.env.JWT_SECRET = saved;
        vi.resetModules();
    });
});

describe('A2b: /bucket routes verify with the central JWT secret', () => {
    it('rejects an upload with no token (401)', async () => {
        const res = await app.request('/api/bucket/uploadData', {
            method: 'POST',
        });
        expect(res.status).toBe(401);
    });

    it('accepts a token signed by the login path (NOT 401)', async () => {
        const loginRes = await login(OWNER_EMAIL, OWNER_PASSWORD);
        const { token } = (await loginRes.json()) as { token: string };

        const res = await app.request('/api/bucket/uploadData', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        // It passes auth and only fails later (missing projectId/files).
        // Before the fix, the bucket middleware verified with a stale hardcoded
        // secret and returned 401 for valid tokens.
        expect(res.status).not.toBe(401);
    });
});
