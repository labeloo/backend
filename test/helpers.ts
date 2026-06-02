import { createClient, type Client } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The real Drizzle migrations, applied in order to build a fresh schema.
 * Using the actual migration SQL (not a hand-written copy) keeps tests honest:
 * if a migration breaks, the tests break too.
 */
const MIGRATIONS = [
    'drizzle/0000_spicy_the_initiative.sql',
    'drizzle/0001_soft_young_avengers.sql',
];

export interface TestDb {
    /** libSQL connection string, e.g. file:/tmp/.../test.db */
    url: string;
    /** Direct client for seeding/asserting against the same DB the app uses. */
    client: Client;
    /** Close the connection and delete the temp directory. */
    cleanup: () => void;
}

/**
 * Spin up an isolated, real SQLite database on disk with the full schema
 * applied. Nothing is mocked — the app talks to this exact file.
 */
export async function createTestDb(): Promise<TestDb> {
    const dir = mkdtempSync(join(tmpdir(), 'labeloo-test-'));
    const dbPath = join(dir, 'test.db');
    const url = `file:${dbPath}`;
    const client = createClient({ url });

    for (const migration of MIGRATIONS) {
        const sql = readFileSync(join(process.cwd(), migration), 'utf8')
            .split('--> statement-breakpoint')
            .join('\n');
        await client.executeMultiple(sql);
    }

    return {
        url,
        client,
        cleanup() {
            client.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

/**
 * Insert a real user with a bcrypt-hashed password (the same hashing the login
 * path verifies against). Returns the new user id.
 */
export async function seedUser(
    client: Client,
    email: string,
    password: string
): Promise<number> {
    const hash = await bcrypt.hash(password, 10);
    const res = await client.execute({
        sql: 'INSERT INTO users (email, password) VALUES (?, ?)',
        args: [email, hash],
    });
    return Number(res.lastInsertRowid);
}

export interface AnnotationContext {
    orgId: number;
    projectTypeId: number;
    projectId: number;
    taskId: number;
}

/**
 * Seed the full FK chain an annotation needs (org -> project_type -> project ->
 * task). Foreign keys ARE enforced, so annotations can't reference dangling ids.
 */
export async function seedAnnotationContext(
    client: Client,
    ownerUserId: number
): Promise<AnnotationContext> {
    const org = await client.execute({
        sql: 'INSERT INTO organizations (owner_id, name) VALUES (?, ?)',
        args: [ownerUserId, 'Test Org'],
    });
    const orgId = Number(org.lastInsertRowid);

    const pt = await client.execute({
        sql: 'INSERT INTO project_type (name) VALUES (?)',
        args: ['object-detection'],
    });
    const projectTypeId = Number(pt.lastInsertRowid);

    const project = await client.execute({
        sql: 'INSERT INTO projects (organization_id, name, project_type) VALUES (?, ?, ?)',
        args: [orgId, 'Test Project', projectTypeId],
    });
    const projectId = Number(project.lastInsertRowid);

    const task = await client.execute({
        sql: 'INSERT INTO tasks (project_id, data_url, data_type) VALUES (?, ?, ?)',
        args: [projectId, 'placeholder.jpg', 'image'],
    });
    const taskId = Number(task.lastInsertRowid);

    return { orgId, projectTypeId, projectId, taskId };
}
