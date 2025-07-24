import { Hono } from 'hono';
import type { Variables } from '../../types';
import type { ProjectPermissionFlags } from '../organizationRoles/types';
import {
    createProjectRole,
    deleteProjectRole,
    getProjectRoleById,
    getProjectRoles,
    updateProjectRole,
} from './service';
import type { projectRoles } from '../../db/schema';

const app = new Hono<{ Variables: Variables }>();

//get all roles
app.get('/all', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');

        const result = await getProjectRoles(db, userId, Number(projectId));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get project roles route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve project roles', details: error.message },
            500
        );
    }
});

//create role
app.post('/create', async (c) => {
    try {
        console.log('Creating project role...');
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        // Parse the request body
        const body = await c.req.json<typeof projectRoles.$inferInsert>();

        const result = await createProjectRole(db, userId, body);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in create project role route:', error);
        return c.json(
            { error: error.message || 'Failed to create project role', details: error.message },
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

        // Get projectId from query parameter
        const projectId = c.req.query('projectId');
        if (!projectId) throw new Error('Project ID is required');

        const result = await getProjectRoleById(
            db,
            Number(id),
            userId,
            Number(projectId)
        );
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get project role by id route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve project role', details: error.message },
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
            Partial<typeof projectRoles.$inferSelect>
        >();

        // Validate the request body
        if (!body.name) throw new Error('Role name is required');
        if (!body.organizationId)
            throw new Error('Organization ID is required');
        if (!body.permissionFlags)
            throw new Error('Permission flags are required');

        const roleData: typeof projectRoles.$inferInsert = {
            name: body.name,
            description: body.description,
            organizationId: body.organizationId,
            permissionFlags: body.permissionFlags,
        };

        const result = await updateProjectRole(
            db,
            roleData,
            Number(id),
            userId
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in update project role route:', error);
        return c.json(
            { error: error.message || 'Failed to update project role', details: error.message },
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

        // Get projectId from query parameter
        const projectId = c.req.query('projectId');
        if (!projectId) throw new Error('Project ID is required');

        const result = await deleteProjectRole(
            db,
            Number(id),
            userId,
            Number(projectId)
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete project role route:', error);
        return c.json(
            { error: error.message || 'Failed to delete project role', details: error.message },
            500
        );
    }
});

export default app;
