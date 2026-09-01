import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';

import type { Variables } from '../../types';
import { organizationRelations } from '../../db/schema';
import { getEntitlements, assertFeature, assertWithinQuota, EntitlementError } from '../../entitlements';
import { resolveActiveBackend, backendAuthHeaders } from '../../backends';
import { recordUsage, usageSince, startOfTodayUnix } from '../../usage';

const app = new Hono<{ Variables: Variables }>();

/**
 * The compute broker.
 *
 * The browser used to call the model service directly, holding its URL and API
 * key. That put the key in every operator's browser and left the server blind
 * to compute, so cloud usage could be neither counted nor limited. Every call
 * now comes here instead: the server resolves the organization's backend,
 * checks entitlements, attaches the key, proxies the request, and records it.
 *
 * The key never leaves the server. The path and body pass through untouched, so
 * the model service's own API is unchanged - this is a transparent proxy that
 * happens to authenticate and meter.
 */

/** Prove membership, exactly as the backendRelations guard does; the orgId
 *  header names the org but does not authorize it. */
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

app.all('/:backendId/*', async (c) => {
    const backendId = c.req.param('backendId');
    const orgId = c.var.verifiedOrgId;

    // What may this org do? Community is unlimited; cloud is metered.
    let entitlements;
    try {
        entitlements = await getEntitlements(c.var.db, orgId);
        assertFeature(entitlements, 'assist');
        // Daily call ceiling. Community is unlimited (-1), so this is a no-op
        // there; in the cloud it enforces the plan against today's ledger.
        const today = await usageSince(c.var.db, orgId, startOfTodayUnix());
        assertWithinQuota(entitlements, 'assist.callsPerDay', today.calls);
    } catch (error) {
        if (error instanceof EntitlementError) {
            return c.json({ error: error.message, code: error.code }, error.status);
        }
        throw error;
    }

    // Resolve where this org's backend of this type lives, and its key.
    const relation = await resolveActiveBackend(c.var.db, orgId, backendId);
    if (!relation) {
        return c.json({ error: 'No active backend of this type', code: 'backend-not-configured' }, 404);
    }

    // Everything after `/api/assist/:backendId` is the service's own path.
    const prefix = `/api/assist/${backendId}`;
    const url = new URL(c.req.url);
    const rest = url.pathname.slice(prefix.length) || '/';
    const upstream = `${relation.baseUrl}${rest}${url.search}`;

    // Forward method, body and content-type; replace any client Authorization
    // with the stored key so the browser can neither see nor spoof it.
    const headers = new Headers();
    const contentType = c.req.header('content-type');
    if (contentType) headers.set('content-type', contentType);
    for (const [k, v] of Object.entries(backendAuthHeaders(relation))) headers.set(k, v);

    const method = c.req.method;
    const body =
        method === 'GET' || method === 'HEAD' ? undefined : await c.req.arrayBuffer();
    const bytesIn = body ? body.byteLength : 0;
    const kind = (rest.split('/').filter(Boolean)[0] || 'root').slice(0, 40);

    const started = Date.now();
    let response: Response;
    try {
        response = await fetch(upstream, { method, headers, body });
    } catch (error) {
        // The service is down or unreachable. A distinct 502 lets the client
        // keep its "Unreachable" state separate from an auth or quota refusal.
        await recordUsage(c.var.db, { organizationId: orgId, backendId, kind, bytesIn, bytesOut: 0, durationMs: Date.now() - started });
        return c.json({ error: 'assist-upstream-unreachable', code: 'upstream-unreachable' }, 502);
    }

    // Stream the body straight through rather than buffering it. The video
    // tracker returns NDJSON one frame at a time so masks appear as they are
    // computed; buffering here would make the operator wait for the whole clip
    // with no progress. bytesOut is taken from content-length when the upstream
    // sends one (the JSON endpoints do) and left at zero for a stream (the
    // tracker does not) - close enough for metering, and streaming is the point.
    const bytesOut = Number(response.headers.get('content-length')) || 0;
    await recordUsage(c.var.db, { organizationId: orgId, backendId, kind, bytesIn, bytesOut, durationMs: Date.now() - started });

    const out = new Headers();
    const upstreamType = response.headers.get('content-type');
    if (upstreamType) out.set('content-type', upstreamType);
    return new Response(response.body, { status: response.status, headers: out });
});

export default app;
