import { Hono } from 'hono';
import type { Variables } from '../../types';
import type { payloadType } from '../auth/types';
import {
    getUserShortcuts,
    getUserShortcutsByScope,
    upsertUserShortcut,
    bulkUpsertUserShortcuts,
    deleteUserShortcut,
    deleteAllUserShortcuts,
    deleteUserShortcutsByScope,
} from './service';

const app = new Hono<{ Variables: Variables }>();

/**
 * GET /shortcuts
 * Get all shortcut overrides for the authenticated user
 * Query params: scope (optional) - filter by scope ('canvas' | 'global' | 'review')
 */
app.get('/', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload as payloadType;
        const userId = payload.userId;

        const scope = c.req.query('scope') as 'canvas' | 'global' | 'review' | undefined;

        let result;
        if (scope) {
            result = await getUserShortcutsByScope(db, userId, scope);
        } else {
            result = await getUserShortcuts(db, userId);
        }

        if (!result.success) {
            throw new Error(result.error);
        }

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get shortcuts route:', error);
        return c.json(
            { error: 'Failed to retrieve shortcuts', details: (error as Error).message },
            500
        );
    }
});

/**
 * PUT /shortcuts
 * Upsert a single shortcut override
 * Body: { action: string, key: string, scope: 'canvas' | 'global' | 'review' }
 */
app.put('/', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload as payloadType;
        const userId = payload.userId;

        const body = await c.req.json();
        const { action, key, scope } = body;

        if (!action || !key) {
            return c.json({ error: 'Action and key are required' }, 400);
        }

        const validScopes = ['canvas', 'global', 'review'];
        if (scope && !validScopes.includes(scope)) {
            return c.json({ error: 'Invalid scope' }, 400);
        }

        const result = await upsertUserShortcut(db, userId, {
            action,
            key,
            scope: scope || 'canvas',
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in upsert shortcut route:', error);
        return c.json(
            { error: 'Failed to save shortcut', details: (error as Error).message },
            500
        );
    }
});

/**
 * PUT /shortcuts/bulk
 * Bulk upsert shortcut overrides
 * Body: { shortcuts: Array<{ action: string, key: string, scope: 'canvas' | 'global' | 'review' }> }
 */
app.put('/bulk', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload as payloadType;
        const userId = payload.userId;

        const body = await c.req.json();
        const { shortcuts } = body;

        if (!Array.isArray(shortcuts)) {
            return c.json({ error: 'Shortcuts array is required' }, 400);
        }

        // Validate each shortcut
        const validScopes = ['canvas', 'global', 'review'];
        for (const shortcut of shortcuts) {
            if (!shortcut.action || !shortcut.key) {
                return c.json({ error: 'Each shortcut must have action and key' }, 400);
            }
            if (shortcut.scope && !validScopes.includes(shortcut.scope)) {
                return c.json({ error: `Invalid scope: ${shortcut.scope}` }, 400);
            }
        }

        const result = await bulkUpsertUserShortcuts(
            db,
            userId,
            shortcuts.map((s) => ({
                action: s.action,
                key: s.key,
                scope: s.scope || 'canvas',
            }))
        );

        if (!result.success) {
            throw new Error(result.error);
        }

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in bulk upsert shortcuts route:', error);
        return c.json(
            { error: 'Failed to save shortcuts', details: (error as Error).message },
            500
        );
    }
});

/**
 * DELETE /shortcuts/:action
 * Delete a specific shortcut override (reset to default)
 */
app.delete('/:action', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload as payloadType;
        const userId = payload.userId;
        const action = c.req.param('action');

        if (!action) {
            return c.json({ error: 'Action is required' }, 400);
        }

        const result = await deleteUserShortcut(db, userId, action);

        if (!result.success) {
            throw new Error(result.error);
        }

        return c.json({ success: true, message: 'Shortcut reset to default' });
    } catch (error) {
        console.error('Error in delete shortcut route:', error);
        return c.json(
            { error: 'Failed to reset shortcut', details: (error as Error).message },
            500
        );
    }
});

/**
 * DELETE /shortcuts
 * Delete all shortcut overrides (reset all to defaults)
 * Query params: scope (optional) - only reset shortcuts for a specific scope
 */
app.delete('/', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload as payloadType;
        const userId = payload.userId;

        const scope = c.req.query('scope') as 'canvas' | 'global' | 'review' | undefined;

        let result;
        if (scope) {
            const validScopes = ['canvas', 'global', 'review'];
            if (!validScopes.includes(scope)) {
                return c.json({ error: 'Invalid scope' }, 400);
            }
            result = await deleteUserShortcutsByScope(db, userId, scope);
        } else {
            result = await deleteAllUserShortcuts(db, userId);
        }

        if (!result.success) {
            throw new Error(result.error);
        }

        return c.json({ success: true, message: scope ? `Shortcuts for ${scope} reset to defaults` : 'All shortcuts reset to defaults' });
    } catch (error) {
        console.error('Error in delete all shortcuts route:', error);
        return c.json(
            { error: 'Failed to reset shortcuts', details: (error as Error).message },
            500
        );
    }
});

export default app;
