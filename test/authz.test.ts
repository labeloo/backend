import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { Variables } from '../src/types';
import { createTestDb, seedUser, type TestDb } from './helpers';

const A = { email: 'a@test.com', password: 'a-password-123' };
const B = { email: 'b@test.com', password: 'b-password-123' };
const C = { email: 'c@test.com', password: 'c-password-123' };

let testDb: TestDb;
let app: Hono<{ Variables: Variables }>;
let idA: number;
let idB: number;

beforeAll(async () => {
    testDb = await createTestDb();
    process.env.DATABASE_URL = testDb.url;
    idA = await seedUser(testDb.client, A.email, A.password);
    idB = await seedUser(testDb.client, B.email, B.password);
    await seedUser(testDb.client, C.email, C.password);
    app = (await import('../src/index')).default;
});

afterAll(() => testDb.cleanup());

async function login(creds: { email: string; password: string }) {
    const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
    });
    const { token } = (await res.json()) as { token: string };
    return token;
}

describe('users endpoints are self-scoped to the JWT (header id cannot target others)', () => {
    it('GET /api/users/ ignores a spoofed id header and returns the caller', async () => {
        const token = await login(A);
        const res = await app.request('/api/users', {
            headers: { Authorization: `Bearer ${token}`, id: String(idB) },
        });
        expect(res.status).toBe(200);
        const { data } = (await res.json()) as {
            data: { id: number; email: string };
        };
        expect(data.email).toBe(A.email);
        expect(data.id).toBe(idA);
    });

    it('PUT /api/users/toggle toggles the caller, not the spoofed id', async () => {
        const token = await login(A);
        await app.request('/api/users/toggle', {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, id: String(idB) },
        });
        // B must be untouched.
        const b = await testDb.client.execute({
            sql: 'SELECT is_active_user FROM users WHERE id = ?',
            args: [idB],
        });
        expect(Number(b.rows[0].is_active_user)).toBe(1);
    });

    it('PUT /api/users/ updates the caller, not the spoofed id', async () => {
        const token = await login(C);
        await app.request('/api/users', {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                id: String(idA),
            },
            body: JSON.stringify({ email: 'pwned@evil.com' }),
        });
        // A's email must be unchanged.
        const a = await testDb.client.execute({
            sql: 'SELECT email FROM users WHERE id = ?',
            args: [idA],
        });
        expect(a.rows[0].email).toBe(A.email);
    });
});

describe('bucket file routes resist path traversal', () => {
    it('GET /api/bucket/taskData/:projectId/:fileName cannot escape the project dir', async () => {
        // fileName traverses up to the backend root package.json.
        const res = await app.request(
            '/api/bucket/taskData/19/..%2F..%2F..%2Fpackage.json'
        );
        expect(res.status).not.toBe(200);
        const body = await res.text();
        expect(body).not.toContain('"name": "backend"');
        expect(body).not.toContain('"dependencies"');
    });

    it('GET /api/bucket/public/:uuid rejects a non-uuid (traversal) value', async () => {
        const res = await app.request(
            '/api/bucket/public/..%2F..%2F..%2Fpackage'
        );
        expect(res.status).not.toBe(200);
    });
});
