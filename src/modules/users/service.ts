import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { users } from '../../db/schema';
import { eq, and, desc, inArray, ilike, like } from 'drizzle-orm';

//get user info by id
export const getUserInfo = async (db: LibSQLDatabase, id: number) => {
    try {
        const result = await db
            .select({
                id: users.id,
                email: users.email,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(eq(users.id, id))
            .get();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting user info:', error);
        return { error: error.message || 'Failed to retrieve user info', success: false };
    }
};

//update user info by id
export const updateUserInfo = async (
    db: LibSQLDatabase,
    id: number,
    body: typeof users.$inferInsert
) => {
    try {
        const result = await db
            .update(users)
            .set({
                email: body.email,
                updatedAt: Math.floor(Date.now() / 1000), // Assuming updatedAt is a timestamp in seconds
            })
            .where(eq(users.id, id))
            .returning()
            .get();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating user info:', error);
        return { error: error.message || 'Failed to update user info', success: false };
    }
};

//toggle user active status
export const toggleUserStatus = async (db: LibSQLDatabase, id: number) => {
    try {
        const user = await db
            .select({ isActiveUser: users.isActiveUser })
            .from(users)
            .where(eq(users.id, id))
            .get();

        if (!user) {
            return { error: 'User not found', success: false };
        }

        const result = await db
            .update(users)
            .set({
                isActiveUser: !user.isActiveUser,
                updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(users.id, id))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error toggling user status:', error);
        return { error: error.message || 'Failed to toggle user status', success: false };
    }
};

export const searchUserByEmail = async (db: LibSQLDatabase, word: string) => {
    try {
        const result = await db
            .select({
                id: users.id,
                email: users.email,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(like(users.email, `%${word}%`))
            .all();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error searching user by email:', error);
        return { error: error.message || 'Failed to search user by email', success: false };
    }
};
