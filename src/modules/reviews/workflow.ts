import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { eq, and, sql } from 'drizzle-orm';
import {
    projects,
    projectRelations,
    projectRoles,
    reviews,
    users,
} from '../../db/schema';
import type { ReviewMode } from '../../db/schema';

// Types for workflow detection
export type WorkflowMode = 'auto-approve' | 'review-required';

export interface WorkflowResult {
    mode: WorkflowMode;
    assignedReviewer?: number;
}

export interface EligibleReviewer {
    userId: number;
    email: string;
    pendingReviewCount: number;
}

export interface ProjectReviewSettings {
    reviewMode: ReviewMode;
    allowSelfReview: boolean;
    autoAssignReviewer: boolean;
}

/**
 * Fetches the review settings for a project
 */
export const getProjectReviewSettings = async (
    db: LibSQLDatabase,
    projectId: number
): Promise<ProjectReviewSettings> => {
    const project = await db
        .select({
            reviewMode: projects.reviewMode,
            allowSelfReview: projects.allowSelfReview,
            autoAssignReviewer: projects.autoAssignReviewer,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();

    if (!project) {
        throw new Error(`Project with id ${projectId} not found`);
    }

    return {
        reviewMode: project.reviewMode,
        allowSelfReview: project.allowSelfReview,
        autoAssignReviewer: project.autoAssignReviewer,
    };
};

/**
 * Gets all project members who have the reviewAnnotations permission,
 * optionally excluding a specific user (e.g., the annotator)
 * 
 * Optimized to use only 2 queries instead of N+1:
 * 1. Fetch all project members with permissions
 * 2. Fetch aggregated pending review counts for all eligible reviewers
 */
export const getEligibleReviewers = async (
    db: LibSQLDatabase,
    projectId: number,
    excludeUserId?: number
): Promise<EligibleReviewer[]> => {
    // Query 1: Get all project members with their roles and permissions
    const projectMembers = await db
        .select({
            userId: projectRelations.userId,
            email: users.email,
            permissionFlags: projectRoles.permissionFlags,
        })
        .from(projectRelations)
        .innerJoin(users, eq(projectRelations.userId, users.id))
        .innerJoin(projectRoles, eq(projectRelations.roleId, projectRoles.id))
        .where(eq(projectRelations.projectId, projectId))
        .all();

    // Filter to only those with reviewAnnotations permission
    const eligibleMembers = projectMembers.filter((member) => {
        // Exclude the specified user if provided
        if (excludeUserId !== undefined && member.userId === excludeUserId) {
            return false;
        }
        // Check if user has reviewAnnotations permission
        return member.permissionFlags?.reviewAnnotations === true;
    });

    // Early return if no eligible members
    if (eligibleMembers.length === 0) {
        return [];
    }

    // Query 2: Get pending review counts for all reviewers in this project (single aggregated query)
    const pendingCounts = await db
        .select({
            reviewerId: reviews.reviewerId,
            count: sql<number>`count(*)`.as('count'),
        })
        .from(reviews)
        .where(
            and(
                eq(reviews.projectId, projectId),
                eq(reviews.status, 'pending')
            )
        )
        .groupBy(reviews.reviewerId)
        .all();

    // Create a map for O(1) lookup of pending counts
    const pendingCountMap = new Map<number, number>(
        pendingCounts.map((row) => [row.reviewerId, row.count])
    );

    // Combine the results
    const reviewersWithCounts: EligibleReviewer[] = eligibleMembers.map((member) => ({
        userId: member.userId,
        email: member.email,
        pendingReviewCount: pendingCountMap.get(member.userId) ?? 0,
    }));

    return reviewersWithCounts;
};

/**
 * Selects the reviewer with the least workload (fewest pending reviews)
 */
export const selectReviewerByWorkload = (
    eligibleReviewers: EligibleReviewer[]
): number => {
    if (eligibleReviewers.length === 0) {
        throw new Error('No eligible reviewers available');
    }

    // Sort by pending review count (ascending) and return the first one
    const sorted = [...eligibleReviewers].sort(
        (a, b) => a.pendingReviewCount - b.pendingReviewCount
    );

    return sorted[0].userId;
};

/**
 * Determines the workflow mode for an annotation submission
 * 
 * Logic:
 * 1. If review_mode is 'always-skip', return auto-approve
 * 2. If review_mode is 'always-required', find a reviewer or throw error if none available
 * 3. If review_mode is 'auto':
 *    - Get eligible reviewers (with reviewAnnotations permission)
 *    - Exclude annotator unless allow_self_review is true
 *    - If no eligible reviewers, return auto-approve
 *    - If reviewers exist, return review-required with optional auto-assigned reviewer
 */
export const determineWorkflowMode = async (
    db: LibSQLDatabase,
    projectId: number,
    annotatorId: number
): Promise<WorkflowResult> => {
    // Fetch project settings
    const settings = await getProjectReviewSettings(db, projectId);

    // Case 1: Always skip review
    if (settings.reviewMode === 'always-skip') {
        return { mode: 'auto-approve' };
    }

    // Get eligible reviewers, potentially excluding the annotator
    const excludeUserId = settings.allowSelfReview ? undefined : annotatorId;
    const eligibleReviewers = await getEligibleReviewers(db, projectId, excludeUserId);

    // Case 2: Always require review
    if (settings.reviewMode === 'always-required') {
        if (eligibleReviewers.length === 0) {
            throw new Error(
                'Review is required but no eligible reviewers are available for this project. ' +
                'Please assign a user with reviewAnnotations permission or change review settings.'
            );
        }

        const result: WorkflowResult = { mode: 'review-required' };

        // Auto-assign reviewer if enabled
        if (settings.autoAssignReviewer) {
            result.assignedReviewer = selectReviewerByWorkload(eligibleReviewers);
        }

        return result;
    }

    // Case 3: Auto mode - decide based on available reviewers
    if (eligibleReviewers.length === 0) {
        // No reviewers available, auto-approve
        return { mode: 'auto-approve' };
    }

    // Reviewers available, require review
    const result: WorkflowResult = { mode: 'review-required' };

    // Auto-assign reviewer if enabled
    if (settings.autoAssignReviewer) {
        result.assignedReviewer = selectReviewerByWorkload(eligibleReviewers);
    }

    return result;
};

/**
 * Checks if a user can review a specific annotation
 * (must have reviewAnnotations permission and not be the annotator unless self-review is allowed)
 */
export const canUserReview = async (
    db: LibSQLDatabase,
    projectId: number,
    reviewerId: number,
    annotatorId: number
): Promise<{ canReview: boolean; reason?: string }> => {
    // Get project settings
    const settings = await getProjectReviewSettings(db, projectId);

    // Check if self-review is attempted
    if (reviewerId === annotatorId && !settings.allowSelfReview) {
        return {
            canReview: false,
            reason: 'Self-review is not allowed for this project',
        };
    }

    // Check if user has reviewAnnotations permission
    const userPermissions = await db
        .select({
            permissionFlags: projectRoles.permissionFlags,
        })
        .from(projectRelations)
        .innerJoin(projectRoles, eq(projectRelations.roleId, projectRoles.id))
        .where(
            and(
                eq(projectRelations.userId, reviewerId),
                eq(projectRelations.projectId, projectId)
            )
        )
        .get();

    if (!userPermissions) {
        return {
            canReview: false,
            reason: 'User is not a member of this project',
        };
    }

    if (!userPermissions.permissionFlags?.reviewAnnotations) {
        return {
            canReview: false,
            reason: 'User does not have permission to review annotations',
        };
    }

    return { canReview: true };
};
