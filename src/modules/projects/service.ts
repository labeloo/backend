import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { projects, projectRelations, organizations } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import fs from 'fs';

//get all projects with userId for specific organization
export const getProjects = async (
    db: LibSQLDatabase,
    userId: number,
    organizationId: number
) => {
    try {
        const result = await db
            .select({
                id: projects.id,
                organizationId: organizations.id,
                organizationName: organizations.name,
                organizationLogo: organizations.logo,
                name: projects.name,
                description: projects.description,
                projectType: projects.projectType,
                roleId: projectRelations.roleId,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
            })
            .from(projects)
            .innerJoin(
                projectRelations,
                eq(projects.id, projectRelations.projectId)
            )
            .innerJoin(
                organizations,
                eq(projects.organizationId, organizations.id)
            )
            .where(
                and(
                    eq(projectRelations.userId, userId),
                    eq(projects.organizationId, organizationId)
                )
            )
            .orderBy(desc(projects.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting projects:', error);
        return {
            error: error.message || 'Failed to retrieve projects',
            success: false,
        };
    }
};

//get project by id
export const getProjectById = async (
    db: LibSQLDatabase,
    userId: number,
    id: number
) => {
    try {
        const result = await db
            .select()
            .from(projects)
            .where(
                and(eq(projects.id, id), eq(projectRelations.userId, userId))
            )
            .innerJoin(
                projectRelations,
                eq(projects.id, projectRelations.projectId)
            )
            .get();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting project by id:', error);
        return {
            error: error.message || 'Failed to retrieve project',
            success: false,
        };
    }
};

//create project (also insert into project relations with transaction when inserting into projects)
export const createProject = async (
    db: LibSQLDatabase,
    projectData: typeof projects.$inferInsert,
    userId: number
) => {
    try {
        let res: typeof projects.$inferInsert | null = null;
        // Start a transaction
        await db.transaction(async (tx) => {
            // Insert into projects table
            const result = await tx
                .insert(projects)
                .values(projectData)
                .returning()
                .get();

            // Insert into project_relations table
            await tx.insert(projectRelations).values({
                userId: userId,
                projectId: result.id,
                roleId: 1, // Assuming 1 is the admin role ID
            });

            // create folder in file system. in bucket/projects/{projectId}
            fs.mkdirSync(`./bucket/projects/${result.id}`, { recursive: true });
            res = result;
        });
        return { data: res, success: true };
    } catch (error) {
        console.error('Error creating project:', error);
        return {
            error: error.message || 'Failed to create project',
            success: false,
        };
    }
};

//update project
export const updateProject = async (
    db: LibSQLDatabase,
    projectData: typeof projects.$inferInsert,
    id: number,
    userId: number
) => {
    try {
        // auth control
        const authorized = await db
            .select()
            .from(projects)
            .innerJoin(
                projectRelations,
                eq(projects.id, projectRelations.projectId)
            )
            .where(
                and(eq(projects.id, id), eq(projectRelations.userId, userId))
            )
            .get();

        if (!authorized) {
            return { error: 'Unauthorized', success: false };
        }

        const result = await db
            .update(projects)
            .set(projectData)
            .where(eq(projects.id, id))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating project:', error);
        return {
            error: error.message || 'Failed to update project',
            success: false,
        };
    }
};

//delete project (also delete from project relations with transaction when deleting from projects with auth control and check if project exists)
export const deleteProject = async (
    db: LibSQLDatabase,
    id: number,
    userId: number
) => {
    try {
        // Check if project exists
        const project = await db
            .select()
            .from(projects)
            .where(eq(projects.id, id))
            .get();

        if (!project) throw new Error('Project not found');

        // auth control
        const authorized = await db
            .select()
            .from(projects)
            .innerJoin(
                projectRelations,
                eq(projects.id, projectRelations.projectId)
            )
            .where(
                and(eq(projects.id, id), eq(projectRelations.userId, userId))
            )
            .get();

        if (!authorized) throw new Error('Unauthorized');

        // Start a transaction
        const result = await db.transaction(async (tx) => {
            // Delete from project_relations table
            await tx
                .delete(projectRelations)
                .where(eq(projectRelations.projectId, id));

            // Delete from projects table
            const result = await tx
                .delete(projects)
                .where(eq(projects.id, id))
                .returning()
                .get();
            return { data: result, success: true };
        });

        if (!result.success) throw new Error('Failed to delete organization');
        return { data: result.data, success: true };
    } catch (error) {
        console.error('Error deleting project:', error);
        return {
            error: error.message || 'Failed to delete project',
            success: false,
        };
    }
};
