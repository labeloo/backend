import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { backendRelations } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import backendTypes from '../../config/backendTypes.json';

// Get all backend types
export const getBackendTypes = async () => {
    try {
        return { data: backendTypes, success: true };
    } catch (error) {
        console.error('Error getting backend types:', error);
        return {
            error: error.message || 'Failed to retrieve backend types',
            success: false,
        };
    }
};

// Get all backend relations for an organization
export const getBackendRelations = async (
    db: LibSQLDatabase,
    organizationId: number
) => {
    try {
        const relations = await db
            .select()
            .from(backendRelations)
            .where(eq(backendRelations.organizationId, organizationId))
            .orderBy(desc(backendRelations.createdAt))
            .all();

        const result = relations.map((relation) => {
            const type = backendTypes.find((t) => t.id === relation.backendId);
            return {
                ...relation,
                backendTypeName: type ? type.name : 'Unknown',
            };
        });

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting backend relations:', error);
        return {
            error: error.message || 'Failed to retrieve backend relations',
            success: false,
        };
    }
};

// Get backend relation by id
export const getBackendRelationById = async (
    db: LibSQLDatabase,
    id: number,
    organizationId: number
) => {
    try {
        const relation = await db
            .select()
            .from(backendRelations)
            .where(
                and(
                    eq(backendRelations.id, id),
                    eq(backendRelations.organizationId, organizationId)
                )
            )
            .get();

        if (!relation) {
            return {
                error: 'Backend relation not found',
                success: false,
            };
        }

        const type = backendTypes.find((t) => t.id === relation.backendId);
        const result = {
            ...relation,
            backendTypeName: type ? type.name : 'Unknown',
        };

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting backend relation by id:', error);
        return {
            error: error.message || 'Failed to retrieve backend relation',
            success: false,
        };
    }
};

// Create backend relation
export const createBackendRelation = async (
    db: LibSQLDatabase,
    data: typeof backendRelations.$inferInsert
) => {
    try {
        const result = await db
            .insert(backendRelations)
            .values(data)
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error creating backend relation:', error);
        return {
            error: error.message || 'Failed to create backend relation',
            success: false,
        };
    }
};

// Update backend relation
export const updateBackendRelation = async (
    db: LibSQLDatabase,
    id: number,
    organizationId: number,
    data: Partial<typeof backendRelations.$inferInsert>
) => {
    try {
        // Check if backend relation exists and belongs to organization
        const existing = await db
            .select()
            .from(backendRelations)
            .where(
                and(
                    eq(backendRelations.id, id),
                    eq(backendRelations.organizationId, organizationId)
                )
            )
            .get();

        if (!existing) {
            return {
                error: 'Backend relation not found',
                success: false,
            };
        }

        const result = await db
            .update(backendRelations)
            .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
            .where(eq(backendRelations.id, id))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating backend relation:', error);
        return {
            error: error.message || 'Failed to update backend relation',
            success: false,
        };
    }
};

// Delete backend relation
export const deleteBackendRelation = async (
    db: LibSQLDatabase,
    id: number,
    organizationId: number
) => {
    try {
        // Check if backend relation exists and belongs to organization
        const existing = await db
            .select()
            .from(backendRelations)
            .where(
                and(
                    eq(backendRelations.id, id),
                    eq(backendRelations.organizationId, organizationId)
                )
            )
            .get();

        if (!existing) {
            return {
                error: 'Backend relation not found',
                success: false,
            };
        }

        const result = await db
            .delete(backendRelations)
            .where(eq(backendRelations.id, id))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error deleting backend relation:', error);
        return {
            error: error.message || 'Failed to delete backend relation',
            success: false,
        };
    }
};
