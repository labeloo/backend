import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import type { payloadType, UserLogin } from './types';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { users } from '../../db/schema';
import { and, eq } from 'drizzle-orm';

import { JWT_SECRET } from '../../config';
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 37; // 37 days

/**
 * Computed per token, never at module scope.
 *
 * At module scope this was wrong twice over: a long-running Node process froze
 * the expiry at boot, so tokens issued on day 30 lasted a week; and on a Worker,
 * module scope runs before any I/O, where `Date.now()` is pinned to 0 - so every
 * token it signed had already expired in 1970.
 */
const expiresAt = () => Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;

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
            isPlatformAdmin: user.isPlatformAdmin,
            exp: expiresAt(),
        };

        const token = await sign(payload, JWT_SECRET);

        // The flag is echoed alongside the token so the frontend can show the
        // admin area without decoding the JWT or making another round trip.
        return { success: true, data: token, isPlatformAdmin: user.isPlatformAdmin };
    } catch (err) {
        console.error('Error during login:', err);
        return { error: 'Internal server error', success: false };
    }
};
