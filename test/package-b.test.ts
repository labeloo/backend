import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import {
    createTestDb,
    seedAnnotationContext,
    seedUser,
    type TestDb,
} from './helpers';

const OWNER = { email: 'owner@test.com', password: 'owner-password-123' };
const OTHER = { email: 'other@test.com', password: 'other-password-123' };

let testDb: TestDb;
let app: Hono;
let ownerId: number;

beforeAll(async () => {
    testDb = await createTestDb();
    process.env.DATABASE_URL = testDb.url;
    ownerId = await seedUser(testDb.client, OWNER.email, OWNER.password);
    await seedUser(testDb.client, OTHER.email, OTHER.password);
    app = (await import('../src/index')).default;
});

afterAll(() => {
    testDb.cleanup();
});

async function login(creds: { email: string; password: string }) {
    const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
    });
    const { token } = (await res.json()) as { token: string };
    return token;
}

function authed(token: string, init: RequestInit = {}) {
    return {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers ?? {}),
        },
    };
}

describe('B1: PUT /api/annotations/:id updates an annotation', () => {
    let ownerToken: string;
    let annotationId: number;

    beforeAll(async () => {
        ownerToken = await login(OWNER);
        // Foreign keys are enforced, so seed the real org/project/task chain.
        const ctx = await seedAnnotationContext(testDb.client, ownerId);
        const res = await app.request(
            '/api/annotations',
            authed(ownerToken, {
                method: 'POST',
                body: JSON.stringify({
                    taskId: ctx.taskId,
                    projectId: ctx.projectId,
                    annotationData: { shape: 'rect', x: 1, y: 2 },
                    reviewStatus: 'pending',
                }),
            })
        );
        expect(res.status).toBe(200);
        const { data } = (await res.json()) as { data: { id: number } };
        annotationId = data.id;
        expect(typeof annotationId).toBe('number');
    });

    it('updates annotationData and persists it', async () => {
        const res = await app.request(
            `/api/annotations/${annotationId}`,
            authed(ownerToken, {
                method: 'PUT',
                body: JSON.stringify({
                    annotationData: { shape: 'rect', x: 99, y: 100 },
                }),
            })
        );
        expect(res.status).toBe(200);
        const { data } = (await res.json()) as {
            data: { annotationData: any };
        };
        expect(data.annotationData).toEqual({ shape: 'rect', x: 99, y: 100 });

        // Persisted: a fresh GET reflects the change.
        const getRes = await app.request(
            `/api/annotations/${annotationId}`,
            authed(ownerToken)
        );
        const got = (await getRes.json()) as {
            data: { annotationData: any };
        };
        expect(got.data.annotationData).toEqual({ shape: 'rect', x: 99, y: 100 });
    });

    it('does NOT let the author self-approve or self-ground-truth (review fields ignored)', async () => {
        const res = await app.request(
            `/api/annotations/${annotationId}`,
            authed(ownerToken, {
                method: 'PUT',
                body: JSON.stringify({
                    annotationData: { shape: 'rect', x: 5, y: 6 },
                    reviewStatus: 'approved',
                    isGroundTruth: true,
                    reviewerId: ownerId,
                }),
            })
        );
        expect(res.status).toBe(200);
        const { data } = (await res.json()) as {
            data: {
                annotationData: any;
                reviewStatus: string;
                isGroundTruth: boolean;
                reviewerId: number | null;
            };
        };
        // Content change applied...
        expect(data.annotationData).toEqual({ shape: 'rect', x: 5, y: 6 });
        // ...but review fields stay at their safe defaults.
        expect(data.reviewStatus).toBe('pending');
        expect(data.isGroundTruth).toBe(false);
        expect(data.reviewerId).toBeNull();
    });

    it('does NOT let a different user update the annotation', async () => {
        const otherToken = await login(OTHER);
        const res = await app.request(
            `/api/annotations/${annotationId}`,
            authed(otherToken, {
                method: 'PUT',
                body: JSON.stringify({ reviewStatus: 'rejected' }),
            })
        );
        expect(res.status).toBe(404);

        // The owner's content is untouched by the other user's attempt.
        const getRes = await app.request(
            `/api/annotations/${annotationId}`,
            authed(ownerToken)
        );
        const got = (await getRes.json()) as {
            data: { annotationData: any; reviewStatus: string };
        };
        expect(got.data.annotationData).toEqual({ shape: 'rect', x: 5, y: 6 });
        expect(got.data.reviewStatus).toBe('pending');
    });

    it('rejects updating an annotation that does not exist', async () => {
        const res = await app.request(
            '/api/annotations/999999',
            authed(ownerToken, {
                method: 'PUT',
                body: JSON.stringify({ reviewStatus: 'rejected' }),
            })
        );
        expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
        const res = await app.request(`/api/annotations/${annotationId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewStatus: 'rejected' }),
        });
        expect(res.status).toBe(401);
    });
});

describe('B2: POST /api/auth/register creates an account', () => {
    const NEW_USER = { email: 'fresh@test.com', password: 'fresh-password-123' };

    it('registers a new user and returns a usable token', async () => {
        const res = await app.request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(NEW_USER),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
            token: string;
            user: { id: number; email: string };
        };
        expect(typeof body.token).toBe('string');
        expect(body.user.email).toBe(NEW_USER.email);

        // The token from registration authenticates protected routes.
        const me = await app.request('/api', authed(body.token));
        expect(me.status).toBe(200);
    });

    it('lets the newly registered user log in (password was hashed correctly)', async () => {
        const res = await app.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(NEW_USER),
        });
        expect(res.status).toBe(200);
        const { token } = (await res.json()) as { token: string };
        expect(typeof token).toBe('string');
    });

    it('rejects a duplicate email with 409', async () => {
        const res = await app.request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(NEW_USER),
        });
        expect(res.status).toBe(409);
    });

    it('rejects an invalid email with 400', async () => {
        const res = await app.request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email', password: 'whatever123' }),
        });
        expect(res.status).toBe(400);
    });

    it('rejects a too-short password with 400', async () => {
        const res = await app.request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'shortpw@test.com', password: '123' }),
        });
        expect(res.status).toBe(400);
    });
});
