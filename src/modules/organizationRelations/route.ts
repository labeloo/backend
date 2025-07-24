import { Hono } from 'hono';
import type { Variables } from '../../types';
import { getOrganizationUsers, insertUserToOrganization, removeUserFromOrganization, updateUserOrganizationRelation } from './service';

const app = new Hono<{ Variables: Variables }>();

//get organizations users
app.get('/users', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const orgId = c.req.header('orgId');
        if (!orgId) throw new Error('Organization ID is required');
        const result = await getOrganizationUsers(db, Number(orgId), userId);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get relations route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve relations', details: error.message },
            500
        );
    }
});

app.post('/addUser', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const orgId = c.req.header('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        // Parse the request body
        const body = await c.req.json() as {
            roleId: number;
            userId: number;
        }[]
        const result = await insertUserToOrganization(
            db,
            Number(orgId),
            userId,
            body
        )
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in add user route:', error);
        return c.json(
            { error: error.message || 'Failed to add user', details: error.message },
            500
        );
    }
});

app.delete('/removeUser', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const orgId = c.req.header('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await removeUserFromOrganization(
            db,
            Number(orgId),
            userId,
            body.userId
        )
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in remove user route:', error);
        return c.json(
            { error: error.message || 'Failed to remove user', details: error.message },
            500
        );
    }
});

app.put('/updateRelation', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const orgId = c.req.header('orgId');
        if (!orgId) throw new Error('Organization ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await updateUserOrganizationRelation(
            db,
            Number(orgId),
            userId,
            body.userId,
            body.newRoleId
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in update relation route:', error);
        return c.json(
            { error: error.message || 'Failed to update relation', details: error.message },
            500
        );
    }
});

export default app;
