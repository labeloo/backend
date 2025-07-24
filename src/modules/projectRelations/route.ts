import { Hono } from 'hono';
import type { Variables } from '../../types';
import { getProjectUsers, insertUserToProject, removeUserFromProject, updateUserProjectRelation } from './service';

const app = new Hono<{ Variables: Variables }>();

//get project users
app.get('/users', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');
        const result = await getProjectUsers(db, Number(projectId), userId);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get project users route:', error);
        return c.json(
            { error: error.message || 'Failed to retrieve project users', details: error.message },
            500
        );
    }
});

app.post('/addUser', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await insertUserToProject(
            db,
            Number(projectId),
            userId,
            body.roleId,
            body.userId
        )
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in add user to project route:', error);
        return c.json(
            { error: error.message || 'Failed to add user to project', details: error.message },
            500
        );
    }
});

app.delete('/removeUser', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await removeUserFromProject(
            db,
            Number(projectId),
            userId,
            body.userId
        )
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in remove user from project route:', error);
        return c.json(
            { error: error.message || 'Failed to remove user from project', details: error.message },
            500
        );
    }
});

app.put('/updateRelation', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await updateUserProjectRelation(
            db,
            Number(projectId),
            userId,
            body.userId,
            body.newRoleId
        );
        if (!result.success) throw new Error(result.error);

        return c.json({ data: 'success' });
    } catch (error) {
        console.error('Error in update project relation route:', error);
        return c.json(
            { error: error.message || 'Failed to update project relation', details: error.message },
            500
        );
    }
});

export default app;
