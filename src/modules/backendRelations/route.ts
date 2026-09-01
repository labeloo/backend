import { Hono } from "hono";
import type { Variables } from '../../types';
import {
    getBackendTypes,
    getBackendRelations,
    getBackendRelationById,
    createBackendRelation,
    updateBackendRelation,
    deleteBackendRelation,
} from './service';
import type { backendRelations } from "../../db/schema";
import { and, eq } from 'drizzle-orm';
import { organizationRelations } from '../../db/schema';
import { checkOrganizationPermission } from '../../utils';

const app = new Hono<{ Variables: Variables }>();

/**
 * Prove the caller belongs to the organization they name.
 *
 * Every route below used to take the organization from an `orgId` request
 * header and query on it directly. Any authenticated user could therefore read,
 * edit or delete ANY organization's model connections - including the api_key
 * stored on them - by changing one header value. The header is still how the
 * client names the org; it is simply no longer trusted.
 */
app.use('*', async (c, next) => {
    // The catalogue of backend types is static and organization-independent.
    if (c.req.path.endsWith('/types')) return next();

    const organizationId = Number(c.req.header('orgId'));
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        return c.json({ error: 'Organization ID is required' }, 400);
    }

    const userId = c.var.jwtPayload.userId;

    if (c.req.method === 'GET') {
        const membership = await c.var.db
            .select({ id: organizationRelations.id })
            .from(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userId),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .get();
        if (!membership) return c.json({ error: 'Forbidden' }, 403);
    } else {
        // Adding or changing where the organization's models live, and the
        // credential that reaches them, is an administrative act.
        const allowed = await checkOrganizationPermission(
            c.var.db,
            userId,
            organizationId,
            'editOrganization'
        );
        if (!allowed) return c.json({ error: 'Forbidden' }, 403);
    }

    c.set('verifiedOrgId', organizationId);
    return next();
});

// Get all backend types
app.get('/types', async (c) => {
    try {
        const result = await getBackendTypes();
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get backend types route:', error);
        return c.json({ error: 'Failed to retrieve backend types', details: error.message }, 500);
    }
});

// Get all backends for specific organization
app.get('/', async (c) => {
    try {
        const db = c.var.db;
        const organizationId = c.var.verifiedOrgId;
        
        const result = await getBackendRelations(db, organizationId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get backends route:', error);
        return c.json({ error: 'Failed to retrieve backends', details: error.message }, 500);
    }
});

// Get backend by id
app.get('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        const organizationId = c.var.verifiedOrgId;
        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const result = await getBackendRelationById(db, Number(id), organizationId);
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get backend by id route:', error);
        return c.json({ error: 'Failed to retrieve backend', details: error.message }, 500);
    }
});

// Create backend
app.post('/', async (c) => {
    try {
        const db = c.var.db;
        const organizationId = c.var.verifiedOrgId;

        const body = await c.req.json<typeof backendRelations.$inferInsert>();

        const backendData: typeof backendRelations.$inferInsert = {
            organizationId: organizationId,
            backendId: body.backendId,
            baseUrl: body.baseUrl,
            apiKey: body.apiKey,
            isActive: body.isActive ?? true,
        };

        const result = await createBackendRelation(db, backendData);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in create backend route:', error);
        return c.json({ error: 'Failed to create backend', details: error.message }, 500);
    }
});

// Update backend by id
app.put('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        const organizationId = c.var.verifiedOrgId;
        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const body = await c.req.json<Partial<typeof backendRelations.$inferInsert>>();

        const result = await updateBackendRelation(db, Number(id), organizationId, body);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in update backend route:', error);
        return c.json({ error: 'Failed to update backend', details: error.message }, 500);
    }
});

// Delete backend by id
app.delete('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        const organizationId = c.var.verifiedOrgId;
        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const result = await deleteBackendRelation(db, Number(id), organizationId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete backend route:', error);
        return c.json({ error: 'Failed to delete backend', details: error.message }, 500);
    }
});

export default app;
