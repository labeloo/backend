import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { projects, projectRelations, projectRoles, organizations } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import fs from 'fs';
import {
    getProjectReviewSettings as getSettingsFromWorkflow,
    getEligibleReviewers as getReviewersFromWorkflow,
    determineWorkflowMode,
    type WorkflowMode,
    type EligibleReviewer,
    type ProjectReviewSettings,
} from '../reviews/workflow';

// ============================================================================
// Types
// ============================================================================

export interface ReviewSettingsResponse extends ProjectReviewSettings {
    currentWorkflowMode: WorkflowMode;
}

export interface EligibleReviewersResponse {
    reviewers: EligibleReviewer[];
    count: number;
}

export interface UpdateReviewSettingsInput {
    reviewMode?: 'auto' | 'always-required' | 'always-skip';
    allowSelfReview?: boolean;
    autoAssignReviewer?: boolean;
}

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

// ============================================================================
// Review Settings Functions
// ============================================================================

/**
 * Checks if user is a member of the project (has any role)
 */
export const isProjectMember = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
): Promise<boolean> => {
    const relation = await db
        .select({ userId: projectRelations.userId })
        .from(projectRelations)
        .where(
            and(
                eq(projectRelations.userId, userId),
                eq(projectRelations.projectId, projectId)
            )
        )
        .get();

    return relation !== undefined;
};

/**
 * Checks if user has editProject permission
 */
export const hasEditProjectPermission = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
): Promise<boolean> => {
    const permissions = await db
        .select({ permissionFlags: projectRoles.permissionFlags })
        .from(projectRoles)
        .innerJoin(
            projectRelations,
            eq(projectRoles.id, projectRelations.roleId)
        )
        .where(
            and(
                eq(projectRelations.userId, userId),
                eq(projectRelations.projectId, projectId)
            )
        )
        .get();

    if (!permissions) return false;
    return permissions.permissionFlags?.editProject === true;
};

/**
 * Updates project review settings
 */
export const updateProjectReviewSettings = async (
    db: LibSQLDatabase,
    projectId: number,
    settings: UpdateReviewSettingsInput
) => {
    try {
        const { reviewMode, allowSelfReview, autoAssignReviewer } = settings;

        // Build update object with only provided fields
        const updateData: Record<string, any> = {
            updatedAt: Math.floor(Date.now() / 1000),
        };

        if (reviewMode !== undefined) {
            updateData.reviewMode = reviewMode;
        }
        if (allowSelfReview !== undefined) {
            updateData.allowSelfReview = allowSelfReview;
        }
        if (autoAssignReviewer !== undefined) {
            updateData.autoAssignReviewer = autoAssignReviewer;
        }

        // Update project
        const updatedProject = await db
            .update(projects)
            .set(updateData)
            .where(eq(projects.id, projectId))
            .returning({
                reviewMode: projects.reviewMode,
                allowSelfReview: projects.allowSelfReview,
                autoAssignReviewer: projects.autoAssignReviewer,
            })
            .get();

        if (!updatedProject) {
            return { error: 'Project not found', success: false };
        }

        return {
            data: {
                reviewMode: updatedProject.reviewMode,
                allowSelfReview: updatedProject.allowSelfReview,
                autoAssignReviewer: updatedProject.autoAssignReviewer,
            },
            success: true,
        };
    } catch (error) {
        console.error('Error updating project review settings:', error);
        return {
            error: error instanceof Error ? error.message : 'Failed to update review settings',
            success: false,
        };
    }
};

/**
 * Gets project review settings and current workflow mode for a user
 */
export const getProjectReviewSettings = async (
    db: LibSQLDatabase,
    projectId: number,
    userId: number
) => {
    try {
        // Fetch review settings
        const settings = await getSettingsFromWorkflow(db, projectId);

        // Determine current workflow mode for this user
        let currentWorkflowMode: WorkflowMode;
        try {
            const workflow = await determineWorkflowMode(db, projectId, userId);
            currentWorkflowMode = workflow.mode;
        } catch {
            // If workflow determination fails (e.g., always-required with no reviewers),
            // still return settings but indicate the issue
            currentWorkflowMode = 'review-required';
        }

        const response: ReviewSettingsResponse = {
            ...settings,
            currentWorkflowMode,
        };

        return { data: response, success: true };
    } catch (error) {
        console.error('Error fetching project review settings:', error);
        return {
            error: error instanceof Error ? error.message : 'Failed to fetch review settings',
            success: false,
        };
    }
};

/**
 * Gets eligible reviewers for a project with their workload
 */
export const getEligibleReviewers = async (
    db: LibSQLDatabase,
    projectId: number
) => {
    try {
        // Verify project exists
        const project = await db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .get();

        if (!project) {
            return { error: 'Project not found', success: false };
        }

        // Get eligible reviewers (don't exclude anyone - show all eligible)
        const reviewers = await getReviewersFromWorkflow(db, projectId);

        const response: EligibleReviewersResponse = {
            reviewers,
            count: reviewers.length,
        };

        return { data: response, success: true };
    } catch (error) {
        console.error('Error fetching eligible reviewers:', error);
        return {
            error: error instanceof Error ? error.message : 'Failed to fetch eligible reviewers',
            success: false,
        };
    }
};

/**
 * Get user's permissions for a specific project
 * Returns a list of permission names the user has for this project
 */
export const getUserProjectPermissions = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
): Promise<{ data?: { permissions: string[] }; error?: string; success: boolean }> => {
    try {
        const result = await db
            .select({ permissionFlags: projectRoles.permissionFlags })
            .from(projectRoles)
            .innerJoin(
                projectRelations,
                eq(projectRoles.id, projectRelations.roleId)
            )
            .where(
                and(
                    eq(projectRelations.userId, userId),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();

        if (!result) {
            return { data: { permissions: [] }, success: true };
        }

        // Convert permission flags to an array of permission names
        const permissions: string[] = [];
        const flags = result.permissionFlags;
        
        if (flags) {
            if (flags.editProject) permissions.push('editProject');
            if (flags.deleteProject) permissions.push('deleteProject');
            if (flags.editMembers) permissions.push('editMembers');
            if (flags.editRoles) permissions.push('editRoles');
            if (flags.uploadFiles) permissions.push('uploadFiles');
            if (flags.reviewAnnotations) permissions.push('reviewAnnotations');
            if (flags.viewReviews) permissions.push('viewReviews');
        }

        return { data: { permissions }, success: true };
    } catch (error) {
        console.error('Error getting user project permissions:', error);
        return {
            error: error instanceof Error ? error.message : 'Failed to get permissions',
            success: false,
        };
    }
};
