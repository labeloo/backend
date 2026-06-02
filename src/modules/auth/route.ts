import { Hono } from 'hono';
import { loginUser, registerUser } from './service';
import type { UserLogin } from './types'; // Assuming you create a types.ts file
import type { Variables } from '../../types';

const auth = new Hono<{ Variables: Variables }>();

// POST /api/users/login
auth.post('/login', async (c) => {
    try {
        const body = await c.req.json<UserLogin>();
        const result = await loginUser(c.var.db, body);

        if (!result.success) throw new Error(result.error);

        return c.json({ token: result.data });
    } catch (error) {
        console.error('Login route error:', error);
        return c.json(
            {
                error: 'Failed to login',
                message: error.message || 'Internal server error',
            },
            500
        );
    }
});

// POST /api/auth/register
auth.post('/register', async (c) => {
    try {
        const body = await c.req.json<UserLogin>();
        const result = await registerUser(c.var.db, body);

        if (!result.success) {
            const code = result.code ?? 400;
            return c.json(
                { error: result.error },
                code === 409 ? 409 : code === 500 ? 500 : 400
            );
        }

        return c.json(result.data, 201);
    } catch (error) {
        console.error('Register route error:', error);
        return c.json(
            {
                error: 'Failed to register',
                message: error.message || 'Internal server error',
            },
            500
        );
    }
});

export default auth;
