import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    projects,
    projectRelations,
    projectRoles,
    users,
    organizations,
} from '../../db/schema';
import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { checkProjectPermission } from '../../utils';

//get all roles
export const getProjectRoles = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
) => {
    try {
        const isUserInProject = await db
            .select()
            .from(projectRelations)
            .where(
                and(
                    eq(projectRelations.userId, userId),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .all();

        if (!isUserInProject.length) {
            return {
                error: 'User is not a member of the project',
                success: false,
            };
        }

        const result = await db
            .select({
                id: projectRoles.id,
                name: projectRoles.name,
                description: projectRoles.description,
                permissionFlags: projectRoles.permissionFlags,
                createdAt: projectRoles.createdAt,
                updatedAt: projectRoles.updatedAt,
            })
            .from(projectRoles)
            .where(
                or(
                    eq(projectRoles.organizationId, isUserInProject[0].projectId),
                    isNull(projectRoles.organizationId)
                )
            )
            .orderBy(desc(projectRoles.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting project roles:', error);
        return { error: error.message || 'Failed to retrieve project roles', success: false };
    }
};

//get role by id
export const getProjectRoleById = async (
    db: LibSQLDatabase,
    id: number,
    userId: number,
    projectId: number
) => {
    try {
        const result = await db
            .select()
            .from(projectRoles)
            .where(eq(projectRoles.id, id))
            .innerJoin(
                projects,
                eq(projectRoles.organizationId, projects.organizationId)
            )
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting project role by id:', error);
        return { error: error.message || 'Failed to retrieve project role', success: false };
    }
};

//create role
export const createProjectRole = async (
    db: LibSQLDatabase,
    userId: number,
    roleData: typeof projectRoles.$inferInsert
) => {
    try {
        if (!roleData.organizationId)
            throw new Error('Organization ID is required');

        // Get project information to check permissions
        const projectInfo = await db
            .select({ organizationId: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, roleData.organizationId))
            .get();

        if (!projectInfo)
            throw new Error('Project not found');

        // Check if user has permission to edit roles in the project
        await checkProjectPermission(
            db,
            userId,
            roleData.organizationId,
            'editRoles'
        );

        const result = await db
            .insert(projectRoles)
            .values(roleData)
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error creating project role:', error);
        return { error: error.message || 'Failed to create project role', success: false };
    }
};

//update role
export const updateProjectRole = async (
    db: LibSQLDatabase,
    roleData: typeof projectRoles.$inferInsert,
    roleId: number,
    userId: number
) => {
    try {
        if (!roleData.organizationId)
            throw new Error('Organization ID is required');

        await checkProjectPermission(
            db, 
            userId, 
            roleData.organizationId, 
            'editRoles'
        );

        const result = await db
            .update(projectRoles)
            .set(roleData)
            .where(eq(projectRoles.id, roleId))
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating project role:', error);
        return { error: error.message || 'Failed to update project role', success: false };
    }
};

//delete role
export const deleteProjectRole = async (
    db: LibSQLDatabase,
    roleId: number,
    userId: number,
    projectId: number
) => {
    try {
        await checkProjectPermission(db, userId, projectId, 'editRoles');

        const result = await db
            .delete(projectRoles)
            .where(eq(projectRoles.id, roleId))
            .returning()
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error deleting project role:', error);
        return { error: error.message || 'Failed to delete project role', success: false };
    }
};
