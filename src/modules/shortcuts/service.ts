import { eq, and } from 'drizzle-orm';
import { userShortcuts } from '../../db/schema';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

export interface ShortcutOverride {
    action: string;
    key: string;
    scope: 'canvas' | 'global' | 'review';
}

export interface UserShortcut extends ShortcutOverride {
    id: number;
    userId: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * Get all shortcut overrides for a user
 */
export const getUserShortcuts = async (
    db: LibSQLDatabase,
    userId: number
): Promise<{ success: boolean; data?: UserShortcut[]; error?: string }> => {
    try {
        const shortcuts = await db
            .select()
            .from(userShortcuts)
            .where(eq(userShortcuts.userId, userId));

        return { success: true, data: shortcuts as UserShortcut[] };
    } catch (error) {
        console.error('Error fetching user shortcuts:', error);
        return { success: false, error: 'Failed to fetch shortcuts' };
    }
};

/**
 * Get shortcuts for a specific scope
 */
export const getUserShortcutsByScope = async (
    db: LibSQLDatabase,
    userId: number,
    scope: 'canvas' | 'global' | 'review'
): Promise<{ success: boolean; data?: UserShortcut[]; error?: string }> => {
    try {
        const shortcuts = await db
            .select()
            .from(userShortcuts)
            .where(
                and(
                    eq(userShortcuts.userId, userId),
                    eq(userShortcuts.scope, scope)
                )
            );

        return { success: true, data: shortcuts as UserShortcut[] };
    } catch (error) {
        console.error('Error fetching user shortcuts by scope:', error);
        return { success: false, error: 'Failed to fetch shortcuts' };
    }
};

/**
 * Upsert a shortcut override for a user
 * If the shortcut exists, update it; otherwise, create it
 */
export const upsertUserShortcut = async (
    db: LibSQLDatabase,
    userId: number,
    shortcut: ShortcutOverride
): Promise<{ success: boolean; data?: UserShortcut; error?: string }> => {
    try {
        // Check if shortcut exists for this action
        const existing = await db
            .select()
            .from(userShortcuts)
            .where(
                and(
                    eq(userShortcuts.userId, userId),
                    eq(userShortcuts.action, shortcut.action)
                )
            )
            .limit(1);

        const now = Math.floor(Date.now() / 1000);

        if (existing.length > 0) {
            // Update existing shortcut
            const updated = await db
                .update(userShortcuts)
                .set({
                    key: shortcut.key,
                    scope: shortcut.scope,
                    updatedAt: now,
                })
                .where(
                    and(
                        eq(userShortcuts.userId, userId),
                        eq(userShortcuts.action, shortcut.action)
                    )
                )
                .returning();

            return { success: true, data: updated[0] as UserShortcut };
        } else {
            // Create new shortcut override
            const inserted = await db
                .insert(userShortcuts)
                .values({
                    userId,
                    action: shortcut.action,
                    key: shortcut.key,
                    scope: shortcut.scope,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning();

            return { success: true, data: inserted[0] as UserShortcut };
        }
    } catch (error) {
        console.error('Error upserting user shortcut:', error);
        return { success: false, error: 'Failed to save shortcut' };
    }
};

/**
 * Bulk upsert shortcuts for a user
 */
export const bulkUpsertUserShortcuts = async (
    db: LibSQLDatabase,
    userId: number,
    shortcuts: ShortcutOverride[]
): Promise<{ success: boolean; data?: UserShortcut[]; error?: string }> => {
    try {
        const results: UserShortcut[] = [];

        for (const shortcut of shortcuts) {
            const result = await upsertUserShortcut(db, userId, shortcut);
            if (result.success && result.data) {
                results.push(result.data);
            } else {
                return { success: false, error: result.error };
            }
        }

        return { success: true, data: results };
    } catch (error) {
        console.error('Error bulk upserting user shortcuts:', error);
        return { success: false, error: 'Failed to save shortcuts' };
    }
};

/**
 * Delete a specific shortcut override (reset to default)
 */
export const deleteUserShortcut = async (
    db: LibSQLDatabase,
    userId: number,
    action: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        await db
            .delete(userShortcuts)
            .where(
                and(
                    eq(userShortcuts.userId, userId),
                    eq(userShortcuts.action, action)
                )
            );

        return { success: true };
    } catch (error) {
        console.error('Error deleting user shortcut:', error);
        return { success: false, error: 'Failed to delete shortcut' };
    }
};

/**
 * Delete all shortcut overrides for a user (reset all to defaults)
 */
export const deleteAllUserShortcuts = async (
    db: LibSQLDatabase,
    userId: number
): Promise<{ success: boolean; error?: string }> => {
    try {
        await db
            .delete(userShortcuts)
            .where(eq(userShortcuts.userId, userId));

        return { success: true };
    } catch (error) {
        console.error('Error deleting all user shortcuts:', error);
        return { success: false, error: 'Failed to reset shortcuts' };
    }
};

/**
 * Delete shortcuts for a specific scope (reset scope to defaults)
 */
export const deleteUserShortcutsByScope = async (
    db: LibSQLDatabase,
    userId: number,
    scope: 'canvas' | 'global' | 'review'
): Promise<{ success: boolean; error?: string }> => {
    try {
        await db
            .delete(userShortcuts)
            .where(
                and(
                    eq(userShortcuts.userId, userId),
                    eq(userShortcuts.scope, scope)
                )
            );

        return { success: true };
    } catch (error) {
        console.error('Error deleting user shortcuts by scope:', error);
        return { success: false, error: 'Failed to reset shortcuts' };
    }
};
