/**
 * Write one row to the metered-work ledger.
 *
 * Both the assist broker and the training subsystem call the same backends and
 * both must be counted the same way, so the insert lives here rather than in
 * either route. Recording must never turn a served call into a failure: the
 * error is swallowed and logged, because a lost usage row is a billing
 * inconvenience, not a reason to break the operator's work.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { and, eq, gte, sql } from 'drizzle-orm';
import { usageEvents } from './db/schema';

export type UsageFields = {
    organizationId: number;
    backendId: string;
    kind: string;
    bytesIn?: number;
    bytesOut?: number;
    durationMs?: number;
    units?: number;
};

export const recordUsage = async (db: LibSQLDatabase, fields: UsageFields): Promise<void> => {
    try {
        await db.insert(usageEvents).values({
            organizationId: fields.organizationId,
            backendId: fields.backendId,
            kind: fields.kind.slice(0, 40),
            units: fields.units ?? 1,
            bytesIn: fields.bytesIn ?? 0,
            bytesOut: fields.bytesOut ?? 0,
            durationMs: fields.durationMs ?? 0,
        });
    } catch (error) {
        console.error('usage_events insert failed (call still served):', error);
    }
};

/**
 * Sum metered work for an organization since a moment, optionally for one
 * backend. Used by the quota checks (calls today, GPU-seconds this period) and
 * by the admin panel. Returns both a call count and the summed units, because
 * different limits count different things.
 */
export const usageSince = async (
    db: LibSQLDatabase,
    organizationId: number,
    sinceUnix: number,
    backendId?: string
): Promise<{ calls: number; units: number; durationMs: number }> => {
    const where = backendId
        ? and(
              eq(usageEvents.organizationId, organizationId),
              gte(usageEvents.createdAt, sinceUnix),
              eq(usageEvents.backendId, backendId)
          )
        : and(
              eq(usageEvents.organizationId, organizationId),
              gte(usageEvents.createdAt, sinceUnix)
          );

    const row = await db
        .select({
            calls: sql<number>`count(*)`,
            units: sql<number>`coalesce(sum(${usageEvents.units}), 0)`,
            durationMs: sql<number>`coalesce(sum(${usageEvents.durationMs}), 0)`,
        })
        .from(usageEvents)
        .where(where)
        .get();

    return {
        calls: Number(row?.calls || 0),
        units: Number(row?.units || 0),
        durationMs: Number(row?.durationMs || 0),
    };
};

/** Unix seconds for the start of today (UTC), the window a per-day quota uses. */
export const startOfTodayUnix = (): number => {
    const now = new Date();
    return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
};

/** Unix seconds for the start of the current month (UTC). */
export const startOfMonthUnix = (): number => {
    const now = new Date();
    return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
};
