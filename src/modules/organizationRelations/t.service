import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    organizations,
    organizationRelations,
    organizationRoles,
    users,
} from '../../db/schema';
import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { checkOrganizationPermission } from '../../utils';

export const getOrganizationUsers = async (
    db: LibSQLDatabase,
    organizationId: number,
    userId: number
) => {
    try {
        // check if user is in organization
        const isMember = await db
            .select()
            .from(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userId),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .get();
        if (!isMember) {
            throw new Error('User is not a member of this organization');
        }

        const result = await db
            .select({
                id: users.id,
                email: users.email,
                isActive: users.isActiveUser,
                role: organizationRoles.name,
                createdAt: users.createdAt,
            })
            .from(organizationRelations)
            .innerJoin(users, eq(organizationRelations.userId, users.id))
            .innerJoin(
                organizationRoles,
                eq(organizationRelations.roleId, organizationRoles.id)
            )
            .where(eq(organizationRelations.organizationId, organizationId))
            .orderBy(desc(users.createdAt));

        return { success: true, data: result };
    } catch (error) {
        console.error('Error fetching organization users:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch organization users',
        };
    }
};

export const insertUserToOrganization = async (
    db: LibSQLDatabase,
    organizationId: number,
    userId: number,
    roleId: number,
    userIdToInsert: number
) => {
    try {
        await checkOrganizationPermission(
            db,
            userId,
            organizationId,
            'editMembers'
        );

        // Check if user is already in the organization
        const existingRelation = await db
            .select()
            .from(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userIdToInsert),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .get();

        if (existingRelation) {
            throw new Error('User is already a member of this organization');
        }

        // Insert the user into the organization
        await db.insert(organizationRelations).values({
            organizationId,
            userId: userIdToInsert,
            roleId,
        });

        return { success: true };
    } catch (error) {
        console.error('Error inserting user to organization:', error);
        return {
            success: false,
            error: error.message || 'Failed to insert user to organization',
        };
    }
};


export const removeUserFromOrganization = async (
    db: LibSQLDatabase,
    organizationId: number,
    userId: number,
    userIdToRemove: number
) => {
    try {
        await checkOrganizationPermission(
            db,
            userId,
            organizationId,
            'editMembers'
        );

        // Check if the user is in the organization
        const userToDeleteRelation = await db
            .select()
            .from(organizationRelations)
            .innerJoin(
                organizationRoles,
                eq(organizationRelations.roleId, organizationRoles.id)
            )
            .where(
                and(
                    eq(organizationRelations.userId, userIdToRemove),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .get();

        if (!userToDeleteRelation) {
            throw new Error('User is not a member of this organization');
        }

        // if userIdToRemove is admin, check if userId is admin
        if (userToDeleteRelation.organization_roles.permissionFlags.admin === true) {
            const isAdmin = await db
                .select()
                .from(organizationRelations)
                .where(
                    and(
                        eq(organizationRelations.userId, userId),
                        eq(organizationRelations.organizationId, organizationId),
                        eq(organizationRelations.roleId, 1)
                    )
                )
                .get();

            if (!isAdmin) {
                throw new Error('Only admins can remove other admins');
            }
        }

        // Remove the user from the organization
        await db
            .delete(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userIdToRemove),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .execute();

        return { success: true };
    } catch (error) {
        console.error('Error removing user from organization:', error);
        return {
            success: false,
            error: error.message || 'Failed to remove user from organization',
        };
    }
};

export const updateUserOrganizationRelation = async (
    db: LibSQLDatabase,
    organizationId: number,
    userId: number,
    userIdToUpdate: number,
    roleId: number
) => {
    try {
        await checkOrganizationPermission(
            db,
            userId,
            organizationId,
            'editMembers'
        );

        // Check if the user is in the organization
        const userIdToUpdateRelation = await db
            .select()
            .from(organizationRelations)
            .innerJoin(
                organizationRoles,
                eq(organizationRelations.roleId, organizationRoles.id)
            )
            .where(
                and(
                    eq(organizationRelations.userId, userIdToUpdate),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .get();

        if (!userIdToUpdateRelation) {
            throw new Error('User is not a member of this organization');
        }

        // Check if the userIdToUpdateRelation is admin
        if (userIdToUpdateRelation.organization_roles.permissionFlags.admin === true) {
            const isAdmin = await db
                .select()
                .from(organizationRelations)
                .where(
                    and(
                        eq(organizationRelations.userId, userId),
                        eq(organizationRelations.organizationId, organizationId),
                        eq(organizationRelations.roleId, 1)
                    )
                )
                .get();

            if (!isAdmin) {
                throw new Error('Only admins can update other admins');
            }
        }

        // Update the user's role in the organization
        await db
            .update(organizationRelations)
            .set({ roleId })
            .where(
                and(
                    eq(organizationRelations.userId, userIdToUpdate),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .execute();

        return { success: true };
    } catch (error) {
        console.error('Error updating user organization relation:', error);
        return {
            success: false,
            error: error.message || 'Failed to update user organization relation',
        };
    }
}