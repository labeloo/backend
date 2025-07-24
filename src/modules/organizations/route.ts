import { Hono } from 'hono';
import type { Variables } from '../../types';
import {
    getUsersOrganizations,
    getOrganizationById,
    createOrganization,
    updateOrganization,
    deleteOrganization,
} from './service';
import type { organizations } from '../../db/schema';

const app = new Hono<{ Variables: Variables }>();

// get all organizations
app.get('/all', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const result = await getUsersOrganizations(db, userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.log('Error in get organizations route:', error);
        return c.json({ error: 'Failed to retrieve organizations', details: error.message }, 500);
    }
});

// get organization by id
app.get('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        if (!id) throw new Error('Organization ID is required');
        const userId = c.var.jwtPayload.userId;

        const result = await getOrganizationById(db, userId, Number(id));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.log('Error in get organization by id route:', error);
        return c.json({ error: 'Failed to retrieve organization', details: error.message }, 500);
    }
});

// create organization. (also insert organization relation for user with admin role, admin roles id is 1)
app.post('/', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload;
        const userId = payload.userId;

        // Parse the request body
        const body = await c.req.json<typeof organizations.$inferInsert>();

        // Set the owner ID to the current user
        const orgData: typeof organizations.$inferInsert = {
            ownerId: userId,
            name: body.name,
            logo: body.logo,
            description: body.description,
        };

        const result = await createOrganization(db, orgData, userId);
        if (!result.success) throw new Error(result.error);

        return c.json({data: result.data});
    } catch (error) {
        console.log('Error in create organization route:', error);
        return c.json({ error: 'Failed to create organization' }, 500);
    }
});

// update organization by id
app.put('/:id', async (c) => {
    try {
        const db = c.var.db;
        const orgId = c.req.param('id');

        if (!orgId) throw new Error('Organization ID is required');

        // Parse the request body
        const body = await c.req.json<Partial<typeof organizations.$inferInsert>>();

        // Validate that at least one field is provided for update
        if (Object.keys(body).length === 0) throw new Error('No fields provided for update');
        const userId = c.var.jwtPayload.userId;

        const result = await updateOrganization(db, Number(orgId), userId, body);
        if (!result.success) throw new Error(result.error);

        return c.json(result.data);
    } catch (error) {
        console.log('Error in update organization route:', error);        }
        return c.json({ error: 'Failed to update organization' }, 500);
});

// delete organization by id
app.delete('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        if (!id) throw new Error('Organization ID is required');
        const userId = c.var.jwtPayload.userId;

        const result = await deleteOrganization(db, Number(id), userId);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.log('Error in delete organization route:', error);
        return c.json({ error: 'Failed to delete organization' }, 500);
    }
});

export default app;
