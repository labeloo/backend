import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    organizations,
    organizationRelations,
    organizationRoles,
    users,
} from '../../db/schema';
import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { checkOrganizationPermission } from '../../utils';

//get all roles
export const getOrganizationRoles = async (
    db: LibSQLDatabase,
    userId: number,
    organizationId: number
) => {
    try {
        const isUserInOrganization = await db
            .select()
            .from(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userId),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .all();

        if (!isUserInOrganization.length) {
            return {
                error: 'User is not a member of the organization',
                success: false,
            };
        }

        const result = await db
            .select({
                id: organizationRoles.id,
                name: organizationRoles.name,
                description: organizationRoles.description,
                permissionFlags: organizationRoles.permissionFlags,
                createdAt: organizationRoles.createdAt,
                updatedAt: organizationRoles.updatedAt,
            })
            .from(organizationRoles)
            .where(
                or(
                    eq(organizationRoles.organizationId, organizationId),
                    isNull(organizationRoles.organizationId)
                )
            )
            .orderBy(desc(organizationRoles.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting roles:', error);
        return { error: error.message || 'Failed to retrieve roles', success: false };
    }
};

//get role by id
export const getOrganizationRoleById = async (
    db: LibSQLDatabase,
    id: number,
    userId: number,
    organizationId: number
) => {
    try {
        const result = await db
            .select()
            .from(organizationRoles)
            .where(eq(organizationRoles.id, id))
            .innerJoin(
                organizations,
                eq(organizationRoles.organizationId, organizations.id)
            )
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting role by id:', error);
        return { error: error.message || 'Failed to retrieve role', success: false };
    }
};

//create role
export const createOrganizationRole = async (
    db: LibSQLDatabase,
    userId: number,
    roleData: typeof organizationRoles.$inferInsert
) => {
    try {
        if (!roleData.organizationId)
            throw new Error('Organization ID is required');

        await checkOrganizationPermission(
            db,
            userId,
            roleData.organizationId,
            'editRoles'
        );

        const result = await db
            .insert(organizationRoles)
            .values(roleData)
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error creating role:', error);
        return { error: error.message || 'Failed to create role', success: false };
    }
};

//update role
export const updateOrganizationRole = async (
    db: LibSQLDatabase,
    roleData: typeof organizationRoles.$inferInsert,
    userId: number,
    orgId: number
) => {
    try {
        await checkOrganizationPermission(db, userId, orgId, 'editRoles');

        const result = await db
            .update(organizationRoles)
            .set(roleData)
            .where(eq(organizationRoles.id, orgId))
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating role:', error);
        return { error: error.message || 'Failed to update role', success: false };
    }
};

//delete role
export const deleteOrganizationRole = async (
    db: LibSQLDatabase,
    orgId: number,
    userId: number
) => {
    try {
        await checkOrganizationPermission(db, userId, orgId, 'editRoles');

        const result = await db
            .delete(organizationRoles)
            .where(eq(organizationRoles.id, orgId))
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error deleting role:', error);
        return { error: error.message || 'Failed to delete role', success: false };
    }
};
