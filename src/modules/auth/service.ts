import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import type { payloadType, UserLogin } from './types';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { users } from '../../db/schema';
import { and, eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'honoiscool';
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
