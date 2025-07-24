import { Hono } from 'hono';
import type { Variables } from '../../types';
import { getUserInfo, updateUserInfo, toggleUserStatus, searchUserByEmail } from './service';

const app = new Hono<{ Variables: Variables }>();

//get users info by id
app.get('/', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.header('id');
        if (!id) throw new Error('User ID is required');
        const result = await getUserInfo(db, Number(id));
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get user by id route:', error);
        return c.json({ error: 'Failed to retrieve user', details: error.message }, 500);
    }
})

//update user info by id
app.put('/', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.header('id');

        if (!id) throw new Error('User ID is required');

        // Parse the request body
        const body = await c.req.json();
        const result = await updateUserInfo(db, Number(id), body);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in update user by id route:', error);
        return c.json({ error: 'Failed to update user', details: error.message }, 500);
    }
})

//toggle user isActive status by id
app.put('/toggle', async (c) => {
    try {
        const db = c.var.db;

        const id = c.req.header('id');
        if (!id) throw new Error('User ID is required');

        const result = await toggleUserStatus(db, Number(id));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in toggle user by id route:', error);
        return c.json({ error: 'Failed to toggle user', details: error.message }, 500);
    }
})

app.get('/search', async (c) => {
    try {
        const db = c.var.db;
        const word = c.req.header('word');
        if (!word) throw new Error('Search word is required');

        const result = await searchUserByEmail(db, word);
        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in search user route:', error);
        return c.json({ error: 'Failed to search user', details: error.message }, 500);
    }
})

export default app;
