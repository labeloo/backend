import { Hono } from 'hono';
import type { Variables } from '../../types';
import type { OrganizationPermissionFlags } from './types';
import {
    createOrganizationRole,
    deleteOrganizationRole,
    getOrganizationRoleById,
    getOrganizationRoles,
    updateOrganizationRole,
} from './service';
import type { organizationRoles } from '../../db/schema';

const app = new Hono<{ Variables: Variables }>();

//get all roles
app.get('/all', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        const orgId = c.req.header('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        const result = await getOrganizationRoles(db, userId, Number(orgId));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get roles route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve roles', details: error.message },
            500
        );
    }
});

//create role
app.post('/create', async (c) => {
    try {
        console.log('Creating role...');
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        // Parse the request body
        const body = await c.req.json<typeof organizationRoles.$inferInsert>();

        const result = await createOrganizationRole(db, userId, body);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in create role route:', error);
        return c.json(
            { error: error.message || 'Failed to create role', details: error.message },
            500
        );
    }
});

//get role by id
app.get('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');

        if (!id) throw new Error('Role ID is required');

        const userId = c.var.jwtPayload.userId;

        // Get orgId from query parameter
        const orgId = c.req.query('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        const result = await getOrganizationRoleById(
            db,
            Number(id),
            userId,
            Number(orgId)
        );
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get role by id route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve role', details: error.message },
            500
        );
    }
});

//update role
app.put('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');

        if (!id) throw new Error('Role ID is required');

        const userId = c.var.jwtPayload.userId;

        // Parse the request body
        const body = await c.req.json<
            Partial<typeof organizationRoles.$inferSelect>
        >();

        // Validate the request body
        if (!body.name) throw new Error('Role name is required');
        if (!body.organizationId)
            throw new Error('Organization ID is required');
        if (!body.permissionFlags)
            throw new Error('Permission flags are required');

        const roleData: typeof organizationRoles.$inferInsert = {
            name: body.name,
            description: body.description,
            organizationId: body.organizationId,
            permissionFlags: body.permissionFlags,
        };

        const result = await updateOrganizationRole(
            db,
            roleData,
            Number(id),
            userId
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in update role route:', error);
        return c.json(
            { error: error.message || 'Failed to update role', details: error.message },
            500
        );
    }
});

//delete role
app.delete('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');

        if (!id) throw new Error('Role ID is required');

        const userId = c.var.jwtPayload.userId;

        // Get orgId from query parameter
        const orgId = c.req.query('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        const result = await deleteOrganizationRole(
            db,
            Number(id),
            userId,
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete role route:', error);
        return c.json(
            { error: error.message || 'Failed to delete role', details: error.message },
            500
        );
    }
});


export default app;
