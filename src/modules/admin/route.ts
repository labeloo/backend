import { Hono } from 'hono';
import { desc, eq, gte, sql, inArray } from 'drizzle-orm';

import type { Variables } from '../../types';
import {
    users,
    organizations,
    projects,
    trainingJobs,
    orgSubscriptions,
    organizationRelations,
    usageEvents,
} from '../../db/schema';
import { planCatalogue } from '../../entitlements';
import { startOfTodayUnix, startOfMonthUnix } from '../../usage';

const app = new Hono<{ Variables: Variables }>();

/**
 * The operator's view of the whole deployment.
 *
 * "Platform admin" is the operator of this install, not an organization admin,
 * so the gate reads the authoritative flag on the user row rather than trusting
 * the token. Everything here is read-mostly; the one write - setting a plan - is
 * the operator override that also stands in for self-serve billing where none is
 * configured.
 */
app.use('*', async (c, next) => {
    const me = await c.var.db
        .select({ isPlatformAdmin: users.isPlatformAdmin })
        .from(users)
        .where(eq(users.id, c.var.jwtPayload.userId))
        .get();
    if (!me?.isPlatformAdmin) return c.json({ error: 'Forbidden' }, 403);
    return next();
});

const count = async (c: any, table: any, where?: any) => {
    const q = c.var.db.select({ n: sql<number>`count(*)` }).from(table);
    const row = await (where ? q.where(where) : q).get();
    return Number(row?.n || 0);
};

/** Headline counts for the operator's first screen. */
app.get('/overview', async (c) => {
    const [orgs, userCount, projectCount, activeJobs] = await Promise.all([
        count(c, organizations),
        count(c, users),
        count(c, projects),
        count(c, trainingJobs, inArray(trainingJobs.status, ['running', 'paused', 'queued'])),
    ]);
    const today = await c.var.db
        .select({ n: sql<number>`count(*)` })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, startOfTodayUnix()))
        .get();
    return c.json({
        data: {
            organizations: orgs,
            users: userCount,
            projects: projectCount,
            activeTrainingJobs: activeJobs,
            computeCallsToday: Number(today?.n || 0),
        },
    });
});

/** Every organization with its plan, member count, and usage this month. */
app.get('/organizations', async (c) => {
    const orgs = await c.var.db.select().from(organizations).orderBy(desc(organizations.createdAt)).all();
    const monthStart = startOfMonthUnix();

    const rows = await Promise.all(
        orgs.map(async (org) => {
            const sub = await c.var.db
                .select()
                .from(orgSubscriptions)
                .where(eq(orgSubscriptions.organizationId, org.id))
                .get();
            const members = await count(c, organizationRelations, eq(organizationRelations.organizationId, org.id));
            const usage = await c.var.db
                .select({
                    calls: sql<number>`count(*)`,
                    durationMs: sql<number>`coalesce(sum(${usageEvents.durationMs}), 0)`,
                })
                .from(usageEvents)
                .where(sql`${usageEvents.organizationId} = ${org.id} and ${usageEvents.createdAt} >= ${monthStart}`)
                .get();
            return {
                id: org.id,
                name: org.name,
                createdAt: org.createdAt,
                plan: sub?.plan || 'free',
                status: sub?.status || 'active',
                members,
                callsThisMonth: Number(usage?.calls || 0),
                gpuSecondsThisMonth: Math.round(Number(usage?.durationMs || 0) / 1000),
            };
        })
    );
    return c.json({ data: rows });
});

/** Platform-wide compute: totals by backend and a 14-day daily series. */
app.get('/usage', async (c) => {
    const since = Math.floor(Date.now() / 1000) - 14 * 86400;
    const byBackend = await c.var.db
        .select({
            backendId: usageEvents.backendId,
            calls: sql<number>`count(*)`,
            durationMs: sql<number>`coalesce(sum(${usageEvents.durationMs}), 0)`,
        })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since))
        .groupBy(usageEvents.backendId)
        .all();

    // One row per day, so the frontend can draw a bar per day with no gaps.
    const daily = await c.var.db
        .select({
            day: sql<string>`date(${usageEvents.createdAt}, 'unixepoch')`,
            calls: sql<number>`count(*)`,
        })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since))
        .groupBy(sql`date(${usageEvents.createdAt}, 'unixepoch')`)
        .all();

    return c.json({ data: { byBackend, daily } });
});

/** Every training job across the platform, newest first. */
app.get('/jobs', async (c) => {
    const rows = await c.var.db.select().from(trainingJobs).orderBy(desc(trainingJobs.createdAt)).limit(100).all();
    return c.json({ data: rows });
});

/** Set an org's plan directly - the operator override and, where no billing
 *  provider is configured, the only way plans change. */
app.post('/organizations/:id/plan', async (c) => {
    const orgId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const plan = String(body.plan || '');
    if (!Number.isInteger(orgId)) return c.json({ error: 'Bad organization id' }, 400);
    if (!planCatalogue().some((p) => p.key === plan)) return c.json({ error: 'Unknown plan' }, 400);

    const now = Math.floor(Date.now() / 1000);
    await c.var.db
        .insert(orgSubscriptions)
        .values({ organizationId: orgId, plan, status: 'active', billingProvider: 'none', updatedAt: now })
        .onConflictDoUpdate({
            target: orgSubscriptions.organizationId,
            set: { plan, status: 'active', updatedAt: now },
        });
    return c.json({ data: { organizationId: orgId, plan } });
});

export default app;
