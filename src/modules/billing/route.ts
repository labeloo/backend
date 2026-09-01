import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';

import type { Variables } from '../../types';
import { organizationRelations, orgSubscriptions } from '../../db/schema';
import { getEntitlements, planCatalogue } from '../../entitlements';
import { usageSince, startOfTodayUnix, startOfMonthUnix } from '../../usage';
import { billingProvider } from '../../billing';
import { checkOrganizationPermission } from '../../utils';

const app = new Hono<{ Variables: Variables }>();

/**
 * Plans, the org's current subscription, and its usage against the plan.
 *
 * The webhook is the one route that cannot require a login - it is called by the
 * billing provider - so it is mounted before the membership guard and trusts a
 * verified signature instead. Everything else names the org with the orgId
 * header and proves membership.
 */

/** Provider callback. No user auth; the provider's signature is the auth. */
app.post('/webhook', async (c) => {
    const raw = await c.req.text();
    const signature = c.req.header('stripe-signature') || null;
    const result = await billingProvider.handleWebhook(raw, signature);
    if (!result) return c.json({ received: true });

    const now = Math.floor(Date.now() / 1000);
    await c.var.db
        .insert(orgSubscriptions)
        .values({
            organizationId: result.orgId,
            plan: result.plan,
            status: result.status,
            billingProvider: billingProvider.name,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: orgSubscriptions.organizationId,
            set: { plan: result.plan, status: result.status, billingProvider: billingProvider.name, updatedAt: now },
        });
    return c.json({ received: true, applied: result });
});

// The catalogue is public within the app; it names no org.
app.get('/plans', (c) => c.json({ data: planCatalogue(), provider: billingProvider.name }));

// Everything below is org-scoped.
app.use('*', async (c, next) => {
    const organizationId = Number(c.req.header('orgId'));
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        return c.json({ error: 'Organization ID is required' }, 400);
    }
    const membership = await c.var.db
        .select({ id: organizationRelations.id })
        .from(organizationRelations)
        .where(
            and(
                eq(organizationRelations.userId, c.var.jwtPayload.userId),
                eq(organizationRelations.organizationId, organizationId)
            )
        )
        .get();
    if (!membership) return c.json({ error: 'Forbidden' }, 403);
    c.set('verifiedOrgId', organizationId);
    return next();
});

/** This org's plan and status. No row means Free. */
app.get('/subscription', async (c) => {
    const sub = await c.var.db
        .select()
        .from(orgSubscriptions)
        .where(eq(orgSubscriptions.organizationId, c.var.verifiedOrgId))
        .get();
    return c.json({ data: sub || { plan: 'free', status: 'active', billingProvider: 'none' } });
});

/** Current-period usage against the plan's limits, for a meter. */
app.get('/usage', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const ent = await getEntitlements(c.var.db, orgId);
    const today = await usageSince(c.var.db, orgId, startOfTodayUnix());
    const month = await usageSince(c.var.db, orgId, startOfMonthUnix(), 'trainer');
    return c.json({
        data: {
            plan: ent.plan,
            edition: ent.edition,
            limits: ent.limits,
            used: {
                'assist.callsPerDay': today.calls,
                'training.gpuSecondsPerMonth': Math.round(month.durationMs / 1000),
            },
        },
    });
});

/** Begin an upgrade. Owner/admin only; the provider decides what happens. */
app.post('/checkout', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const allowed = await checkOrganizationPermission(c.var.db, c.var.jwtPayload.userId, orgId, 'editOrganization');
    if (!allowed) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({}));
    const plan = String(body.plan || '');
    if (!planCatalogue().some((p) => p.key === plan)) return c.json({ error: 'Unknown plan' }, 400);
    const result = await billingProvider.createCheckout(orgId, plan);
    return c.json({ data: result });
});

export default app;
