import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    projects,
    projectRelations,
    projectRoles,
    users,
} from '../../db/schema';
import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { checkProjectPermission } from '../../utils';

export const getProjectUsers = async (
    db: LibSQLDatabase,
    projectId: number,
    userId: number
) => {
    try {
        // check if user is in project
        const isMember = await db
            .select()
            .from(projectRelations)
            .where(
                and(
                    eq(projectRelations.userId, userId),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();
        if (!isMember) {
            throw new Error('User is not a member of this project');
        }

        const result = await db
            .select({
                id: users.id,
                email: users.email,
                isActive: users.isActiveUser,
                role: projectRoles.name,
                createdAt: users.createdAt,
            })
            .from(projectRelations)
            .innerJoin(users, eq(projectRelations.userId, users.id))
            .innerJoin(
                projectRoles,
                eq(projectRelations.roleId, projectRoles.id)
            )
            .where(eq(projectRelations.projectId, projectId))
            .orderBy(desc(users.createdAt));

        return { success: true, data: result };
    } catch (error) {
        console.error('Error fetching project users:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch project users',
        };
    }
};

export const insertUserToProject = async (
    db: LibSQLDatabase,
    projectId: number,
    userId: number,
    roleId: number,
    userIdToInsert: number
) => {
    try {
        await checkProjectPermission(
            db,
            userId,
            projectId,
            'editMembers'
        );

        // Check if user is already in the project
        const existingRelation = await db
            .select()
            .from(projectRelations)
            .where(
                and(
                    eq(projectRelations.userId, userIdToInsert),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();

        if (existingRelation) {
            throw new Error('User is already a member of this project');
        }

        // Insert the user into the project
        await db.insert(projectRelations).values({
            projectId,
            userId: userIdToInsert,
            roleId,
        });

        return { success: true };
    } catch (error) {
        console.error('Error inserting user to project:', error);
        return {
            success: false,
            error: error.message || 'Failed to insert user to project',
        };
    }
};

export const removeUserFromProject = async (
    db: LibSQLDatabase,
    projectId: number,
    userId: number,
    userIdToRemove: number
) => {
    try {
        await checkProjectPermission(
            db,
            userId,
            projectId,
            'editMembers'
        );

        // Check if the user is in the project
        const userToDeleteRelation = await db
            .select()
            .from(projectRelations)
            .innerJoin(
                projectRoles,
                eq(projectRelations.roleId, projectRoles.id)
            )
            .where(
                and(
                    eq(projectRelations.userId, userIdToRemove),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();

        if (!userToDeleteRelation) {
            throw new Error('User is not a member of this project');
        }

        // Remove the user from the project
        await db
            .delete(projectRelations)
            .where(
                and(
                    eq(projectRelations.userId, userIdToRemove),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .execute();

        return { success: true };
    } catch (error) {
        console.error('Error removing user from project:', error);
        return {
            success: false,
            error: error.message || 'Failed to remove user from project',
        };
    }
};

export const updateUserProjectRelation = async (
    db: LibSQLDatabase,
    projectId: number,
    userId: number,
    userIdToUpdate: number,
    roleId: number
) => {
    try {
        await checkProjectPermission(
            db,
            userId,
            projectId,
            'editMembers'
        );

        // Check if the user is in the project
        const userIdToUpdateRelation = await db
            .select()
            .from(projectRelations)
            .innerJoin(
                projectRoles,
                eq(projectRelations.roleId, projectRoles.id)
            )
            .where(
                and(
                    eq(projectRelations.userId, userIdToUpdate),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();

        if (!userIdToUpdateRelation) {
            throw new Error('User is not a member of this project');
        }

        // Update the user's role in the project
        await db
            .update(projectRelations)
            .set({ roleId })
            .where(
                and(
                    eq(projectRelations.userId, userIdToUpdate),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .execute();

        return { success: true };
    } catch (error) {
        console.error('Error updating user project relation:', error);
        return {
            success: false,
            error: error.message || 'Failed to update user project relation',
        };
    }
};
