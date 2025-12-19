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

const app = new Hono<{ Variables: Variables }>();

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
        const organizationId = c.req.header('orgId');
        if (!organizationId) throw new Error('Organization ID is required');
        
        const result = await getBackendRelations(db, Number(organizationId));

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
        const organizationId = c.req.header('orgId');
        
        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const result = await getBackendRelationById(db, Number(id), Number(organizationId));
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
        const organizationId = c.req.header('orgId');
        if (!organizationId) throw new Error('Organization ID is required');

        const body = await c.req.json<typeof backendRelations.$inferInsert>();

        const backendData: typeof backendRelations.$inferInsert = {
            organizationId: Number(organizationId),
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
        const organizationId = c.req.header('orgId');

        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const body = await c.req.json<Partial<typeof backendRelations.$inferInsert>>();

        const result = await updateBackendRelation(db, Number(id), Number(organizationId), body);

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
        const organizationId = c.req.header('orgId');

        if (!id) throw new Error('Backend ID is required');
        if (!organizationId) throw new Error('Organization ID is required');

        const result = await deleteBackendRelation(db, Number(id), Number(organizationId));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete backend route:', error);
        return c.json({ error: 'Failed to delete backend', details: error.message }, 500);
    }
});

export default app;
