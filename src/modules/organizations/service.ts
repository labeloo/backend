import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    organizations,
    organizationRelations,
    organizationRoles,
} from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkOrganizationPermission } from '../../utils';

// Get all organizations
export const getUsersOrganizations = async (
    db: LibSQLDatabase,
    userId: number
) => {
    try {
        const result = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                logo: organizations.logo,
                description: organizations.description,
                isActiveOrg: organizations.isActiveOrg,
                createdAt: organizations.createdAt,
                updatedAt: organizations.updatedAt,
            })
            .from(organizations)
            .innerJoin(
                organizationRelations,
                eq(organizations.id, organizationRelations.organizationId)
            )
            .where(eq(organizationRelations.userId, userId))
            .orderBy(desc(organizations.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting organizations:', error);
        return { error: error.message || 'Failed to retrieve organizations', success: false };
    }
};

// Get organization by id
export const getOrganizationById = async (
    db: LibSQLDatabase,
    userId: number,
    id: number
) => {
    try {
        const result = await db
            .select()
            .from(organizations)
            .where(
                and(
                    eq(organizations.id, id),
                    eq(organizationRelations.userId, userId)
                )
            )
            .innerJoin(
                organizationRelations,
                eq(organizations.id, organizationRelations.organizationId)
            )
            .all();

        if (!result) throw new Error('Organization not found');

        // No need to check permissions for viewing, as the user is already related to the organization
        return { data: result, success: true };
    } catch (error) {
        console.error(`Error getting organization id ${id}:`, error);
        return { error: error.message || 'Failed to retrieve organization', success: false };
    }
};

// Create organization
export const createOrganization = async (
    db: LibSQLDatabase,
    organizationData: typeof organizations.$inferInsert,
    userId: number
) => {
    try {
        // Start a transaction
        const result = await db.transaction(async (tx) => {
            // Insert the organization
            const result = await tx
                .insert(organizations)
                .values({
                    name: organizationData.name,
                    ownerId: userId,
                    logo: organizationData.logo,
                    description: organizationData.description,
                    isActiveOrg: organizationData.isActiveOrg ?? true,
                })
                .returning()
                .get();

            // Get the admin role (assuming role id 1 is admin as per the comment in route.ts)
            const adminRoleId = 1;
            await tx.insert(organizationRelations).values({
                userId: userId,
                organizationId: result.id,
                roleId: adminRoleId,
            });

            return { data: result, success: true };
        });

        if (!result.success) throw new Error('Failed to create organization');
        return { data: result.data, success: true };
    } catch (error) {
        console.error('Error creating organization:', error);
        return { error: error.message || 'Failed to create organization', success: false };
    }
};

// Update organization
export const updateOrganization = async (
    db: LibSQLDatabase,
    orgId: number,
    userId: number,
    organizationData: Partial<typeof organizations.$inferInsert>
) => {
    try {
        await checkOrganizationPermission(db, userId, orgId, 'editOrganization');

        // Check if organization exists
        const orgExists = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(
                and(
                    eq(organizations.id, orgId),
                    eq(organizationRelations.userId, userId)
                )
            )
            .innerJoin(
                organizationRelations,
                eq(organizations.id, organizationRelations.organizationId)
            )
            .get();

        if (!orgExists) throw new Error('Organization not found');

        const result = await db
            .update(organizations)
            .set({
                name: organizationData.name,
                logo: organizationData.logo,
                description: organizationData.description,
                isActiveOrg: organizationData.isActiveOrg,
                updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(organizations.id, orgId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error(`Error updating organization id ${orgId}:`, error);
        return { error: error.message || 'Failed to update organization', success: false };
    }
};

// Delete organization
export const deleteOrganization = async (
    db: LibSQLDatabase,
    orgId: number,
    userId: number
) => {
    try {
        await checkOrganizationPermission(db, userId, orgId, 'deleteOrganization');

        // Check if organization exists
        const orgExists = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(
                and(
                    eq(organizations.id, orgId),
                    eq(organizationRelations.userId, userId)
                )
            )
            .innerJoin(
                organizationRelations,
                eq(organizations.id, organizationRelations.organizationId)
            )
            .get();

        if (!orgExists) throw new Error('Organization not found');

        // Start a transaction
        const result = await db.transaction(async (tx) => {
            // Delete related organization_relations first
            await tx
                .delete(organizationRelations)
                .where(eq(organizationRelations.organizationId, orgId));
            // Delete the organization
            const result = await tx
                .delete(organizations)
                .where(eq(organizations.id, orgId))
                .returning()
                .get();

            return { data: result, success: true };
        });
        if (!result.success) throw new Error('Failed to delete organization');
        return { data: result.data, success: true };
    } catch (error) {
        console.error(`Error deleting organization id ${orgId}:`, error);
        return { error: error.message || 'Failed to delete organization', success: false };
    }
};
