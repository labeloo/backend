import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import type { payloadType, UserLogin } from './types';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { users } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { JWT_SECRET } from '../../config';

const JWT_EXPIRATION = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 37; // 37 days

export const loginUser = async (
    db: LibSQLDatabase,
    credentials: UserLogin
) => {
    try {
        const { email, password } = credentials;

        if (!email || !password) throw new Error('Email and password are required');
        if (!email.includes('@')) throw new Error('Invalid email format');

        const user = await db.select().from(users).where(eq(users.email, email)).get();
        if (!user) throw new Error('User not found');

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) throw new Error('Invalid password');

        const payload: payloadType = {
            userId: user.id,
            email: user.email,
            exp: JWT_EXPIRATION,
        };

        const token = await sign(payload, JWT_SECRET);

        return { success: true, data: token };
    } catch (err) {
        console.error('Error during login:', err);
        return { error: 'Internal server error', success: false };
    }
};

export const registerUser = async (
    db: LibSQLDatabase,
    credentials: UserLogin
) => {
    const { email, password } = credentials;

    if (!email || !password)
        return { error: 'Email and password are required', success: false, code: 400 };
    if (!email.includes('@'))
        return { error: 'Invalid email format', success: false, code: 400 };
    if (password.length < 6)
        return {
            error: 'Password must be at least 6 characters',
            success: false,
            code: 400,
        };

    try {
        const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .get();
        if (existing)
            return { error: 'Email already registered', success: false, code: 409 };

        const hash = await bcrypt.hash(password, 10);
        const user = await db
            .insert(users)
            .values({ email, password: hash })
            .returning()
            .get();

        const token = await sign(
            { userId: user.id, email: user.email, exp: JWT_EXPIRATION },
            JWT_SECRET
        );

        return {
            success: true,
            data: { token, user: { id: user.id, email: user.email } },
        };
    } catch (err) {
        console.error('Error during registration:', err);
        return { error: 'Internal server error', success: false, code: 500 };
    }
};
