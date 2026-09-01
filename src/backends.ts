/**
 * Resolve where an organization's backend of a given type lives, and its key.
 *
 * The service URL and the credential are stored per organization in
 * `backend_relations` and must stay on the server. Any code that needs to reach
 * a backend - the broker proxying a click, the trainer orchestration starting a
 * run - asks here rather than reading the row itself, so there is one place that
 * knows a disabled relation is not usable.
 */
import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { backendRelations } from './db/schema';

export type ResolvedBackend = { baseUrl: string; apiKey: string };

export const resolveActiveBackend = async (
    db: LibSQLDatabase,
    organizationId: number,
    backendId: string
): Promise<ResolvedBackend | null> => {
    const relation = await db
        .select()
        .from(backendRelations)
        .where(
            and(
                eq(backendRelations.organizationId, organizationId),
                eq(backendRelations.backendId, backendId)
            )
        )
        .get();

    if (!relation || relation.isActive === false) return null;
    return { baseUrl: relation.baseUrl.replace(/\/+$/, ''), apiKey: relation.apiKey || '' };
};

/** Authorization header for a resolved backend, empty when it needs no key. */
export const backendAuthHeaders = (backend: ResolvedBackend): Record<string, string> =>
    backend.apiKey ? { authorization: `Bearer ${backend.apiKey}` } : {};
