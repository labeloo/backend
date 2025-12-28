import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import {
    reviews,
    annotations,
    tasks,
    users,
    projects,
} from '../../db/schema';
import type { ReviewStatus } from '../../db/schema';

// Types
export interface CreateReviewInput {
    annotationId: number;
    reviewerId: number;
    status: 'approved' | 'rejected' | 'changes_requested';
    message?: string;
    projectId: number;
    taskId: number;
    isAutoApproved?: boolean;
}

export interface UpdateReviewInput {
    status?: 'approved' | 'rejected' | 'changes_requested';
    message?: string;
}

export interface ReviewFilters {
    status?: ReviewStatus;
    reviewerId?: number;
    page: number;
    limit: number;
}

export interface PaginatedReviewsResult {
    reviews: any[];
    total: number;
    page: number;
    limit: number;
}

// Helper to generate unique review ID
const generateReviewId = (): string => {
    return `rev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Helper to map review status to task status
const getTaskStatusFromReviewStatus = (
    reviewStatus: 'approved' | 'rejected' | 'changes_requested'
): 'completed' | 'changes_needed' => {
    if (reviewStatus === 'approved') {
        return 'completed';
    }
    return 'changes_needed';
};

// Helper to map review status to annotation review status
const getAnnotationReviewStatus = (
    reviewStatus: 'approved' | 'rejected' | 'changes_requested'
): 'approved' | 'rejected' | 'pending' => {
    if (reviewStatus === 'approved') return 'approved';
    if (reviewStatus === 'rejected') return 'rejected';
    // changes_requested maps to pending since they need to resubmit
    return 'pending';
};

/**
 * Create a new review record
 * - Creates the review
 * - Updates annotation's review_status and reviewer_id
 * - Updates task status based on review decision
 * - Uses transaction for atomicity
 */
export const createReview = async (
    db: LibSQLDatabase,
    input: CreateReviewInput
): Promise<{ data?: typeof reviews.$inferSelect; error?: string; success: boolean }> => {
    try {
        const reviewId = generateReviewId();
        const now = Math.floor(Date.now() / 1000);

        // Get current review round for this annotation
        const existingReviews = await db
            .select({ reviewRound: reviews.reviewRound })
            .from(reviews)
            .where(eq(reviews.annotationId, input.annotationId))
            .orderBy(desc(reviews.reviewRound))
            .limit(1)
            .get();

        const reviewRound = (existingReviews?.reviewRound ?? 0) + 1;

        // Determine the new task status and annotation review status
        const newTaskStatus = getTaskStatusFromReviewStatus(input.status);
        const newAnnotationReviewStatus = getAnnotationReviewStatus(input.status);

        // Use batch for transaction-like behavior
        // Note: libsql/drizzle doesn't have full transaction support in all contexts,
        // so we use batch which executes atomically
        const result = await db.batch([
            // 1. Insert the review (reviewerId = who performed the review)
            db.insert(reviews).values({
                id: reviewId,
                annotationId: input.annotationId,
                taskId: input.taskId,
                projectId: input.projectId,
                reviewerId: input.reviewerId,
                status: input.status,
                message: input.message ?? null,
                isAutoApproved: input.isAutoApproved ?? false,
                reviewRound,
                createdAt: now,
                updatedAt: now,
            }),

            // 2. Update the annotation's review status
            // Note: We don't update assignedReviewerId here - it's set during workflow assignment
            // The actual reviewer is tracked in the reviews table
            db.update(annotations)
                .set({
                    reviewStatus: newAnnotationReviewStatus,
                    updatedAt: now,
                })
                .where(eq(annotations.id, input.annotationId)),

            // 3. Update the task status
            db.update(tasks)
                .set({
                    status: newTaskStatus,
                    updatedAt: now,
                })
                .where(eq(tasks.id, input.taskId)),
        ]);

        // Fetch the created review to return
        const createdReview = await db
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .get();

        return { data: createdReview, success: true };
    } catch (error) {
        console.error('Error creating review:', error);
        return {
            error: error.message || 'Failed to create review',
            success: false,
        };
    }
};

/**
 * Update an existing review
 * - Updates the review record
 * - Syncs annotation's review_status and reviewer_id
 * - Updates task status accordingly
 * - Uses transaction for atomicity
 */
export const updateReview = async (
    db: LibSQLDatabase,
    reviewId: string,
    input: UpdateReviewInput
): Promise<{ data?: typeof reviews.$inferSelect; error?: string; success: boolean }> => {
    try {
        // First, fetch the existing review
        const existingReview = await db
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .get();

        if (!existingReview) {
            return { error: 'Review not found', success: false };
        }

        const now = Math.floor(Date.now() / 1000);

        // Build the review update
        const reviewUpdate: Partial<typeof reviews.$inferInsert> = {
            updatedAt: now,
        };
        if (input.status !== undefined) {
            reviewUpdate.status = input.status;
        }
        if (input.message !== undefined) {
            reviewUpdate.message = input.message;
        }

        // If status changed, update annotation and task as well
        if (input.status !== undefined && input.status !== existingReview.status) {
            const newTaskStatus = getTaskStatusFromReviewStatus(input.status);
            const newAnnotationReviewStatus = getAnnotationReviewStatus(input.status);

            // Use batch with all three updates
            await db.batch([
                db.update(reviews)
                    .set(reviewUpdate)
                    .where(eq(reviews.id, reviewId)),
                db.update(annotations)
                    .set({
                        reviewStatus: newAnnotationReviewStatus,
                        updatedAt: now,
                    })
                    .where(eq(annotations.id, existingReview.annotationId)),
                db.update(tasks)
                    .set({
                        status: newTaskStatus,
                        updatedAt: now,
                    })
                    .where(eq(tasks.id, existingReview.taskId)),
            ]);
        } else {
            // Only update the review itself
            await db.update(reviews)
                .set(reviewUpdate)
                .where(eq(reviews.id, reviewId));
        }

        // Fetch and return the updated review
        const updatedReview = await db
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .get();

        return { data: updatedReview, success: true };
    } catch (error) {
        console.error('Error updating review:', error);
        return {
            error: error.message || 'Failed to update review',
            success: false,
        };
    }
};

/**
 * Fetch all reviews for an annotation, ordered by created_at DESC
 * Includes reviewer user info (email)
 */
export const getReviewsByAnnotation = async (
    db: LibSQLDatabase,
    annotationId: number
): Promise<{ data?: any[]; error?: string; success: boolean }> => {
    try {
        const result = await db
            .select({
                id: reviews.id,
                annotationId: reviews.annotationId,
                taskId: reviews.taskId,
                projectId: reviews.projectId,
                reviewerId: reviews.reviewerId,
                status: reviews.status,
                message: reviews.message,
                isAutoApproved: reviews.isAutoApproved,
                reviewRound: reviews.reviewRound,
                createdAt: reviews.createdAt,
                updatedAt: reviews.updatedAt,
                reviewerEmail: users.email,
            })
            .from(reviews)
            .leftJoin(users, eq(reviews.reviewerId, users.id))
            .where(eq(reviews.annotationId, annotationId))
            .orderBy(desc(reviews.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting reviews by annotation:', error);
        return {
            error: error.message || 'Failed to retrieve reviews',
            success: false,
        };
    }
};

/**
 * Fetch paginated reviews for a project
 * Apply optional filters (status, reviewerId)
 * Include annotation data and task data
 */
export const getReviewsByProject = async (
    db: LibSQLDatabase,
    projectId: number,
    filters: ReviewFilters
): Promise<{ data?: PaginatedReviewsResult; error?: string; success: boolean }> => {
    try {
        const { status, reviewerId, page, limit } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [eq(reviews.projectId, projectId)];
        if (status) {
            conditions.push(eq(reviews.status, status));
        }
        if (reviewerId) {
            conditions.push(eq(reviews.reviewerId, reviewerId));
        }

        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

        // Get total count
        const totalResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(reviews)
            .where(whereClause)
            .get();

        const total = totalResult?.count ?? 0;

        // Get paginated reviews with joins
        const reviewsResult = await db
            .select({
                // Review fields
                id: reviews.id,
                annotationId: reviews.annotationId,
                taskId: reviews.taskId,
                projectId: reviews.projectId,
                reviewerId: reviews.reviewerId,
                status: reviews.status,
                message: reviews.message,
                isAutoApproved: reviews.isAutoApproved,
                reviewRound: reviews.reviewRound,
                createdAt: reviews.createdAt,
                updatedAt: reviews.updatedAt,
                // Reviewer info
                reviewerEmail: users.email,
                // Task info
                taskDataUrl: tasks.dataUrl,
                taskStatus: tasks.status,
                // Annotation info
                annotationData: annotations.annotationData,
                annotatorId: annotations.userId,
            })
            .from(reviews)
            .leftJoin(users, eq(reviews.reviewerId, users.id))
            .leftJoin(tasks, eq(reviews.taskId, tasks.id))
            .leftJoin(annotations, eq(reviews.annotationId, annotations.id))
            .where(whereClause)
            .orderBy(desc(reviews.createdAt))
            .limit(limit)
            .offset(offset)
            .all();

        return {
            data: {
                reviews: reviewsResult,
                total,
                page,
                limit,
            },
            success: true,
        };
    } catch (error) {
        console.error('Error getting reviews by project:', error);
        return {
            error: error.message || 'Failed to retrieve reviews',
            success: false,
        };
    }
};

/**
 * Fetch pending reviews assigned to a specific user
 * Optionally filter by project
 * Include annotation and task details
 */
export const getReviewsAssignedToUser = async (
    db: LibSQLDatabase,
    userId: number,
    projectId?: number
): Promise<{ data?: any[]; error?: string; success: boolean }> => {
    try {
        // Build where conditions
        const conditions = [
            eq(reviews.reviewerId, userId),
            eq(reviews.status, 'pending'),
        ];

        if (projectId) {
            conditions.push(eq(reviews.projectId, projectId));
        }

        const whereClause = and(...conditions);

        const result = await db
            .select({
                // Review fields
                id: reviews.id,
                annotationId: reviews.annotationId,
                taskId: reviews.taskId,
                projectId: reviews.projectId,
                reviewerId: reviews.reviewerId,
                status: reviews.status,
                message: reviews.message,
                isAutoApproved: reviews.isAutoApproved,
                reviewRound: reviews.reviewRound,
                createdAt: reviews.createdAt,
                updatedAt: reviews.updatedAt,
                // Task info
                taskDataUrl: tasks.dataUrl,
                taskDataType: tasks.dataType,
                taskStatus: tasks.status,
                taskMetadata: tasks.metadata,
                // Annotation info
                annotationData: annotations.annotationData,
                annotatorId: annotations.userId,
                // Project info
                projectName: projects.name,
            })
            .from(reviews)
            .leftJoin(tasks, eq(reviews.taskId, tasks.id))
            .leftJoin(annotations, eq(reviews.annotationId, annotations.id))
            .leftJoin(projects, eq(reviews.projectId, projects.id))
            .where(whereClause)
            .orderBy(desc(reviews.createdAt))
            .all();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting reviews assigned to user:', error);
        return {
            error: error.message || 'Failed to retrieve assigned reviews',
            success: false,
        };
    }
};

/**
 * Get a single review by ID
 */
export const getReviewById = async (
    db: LibSQLDatabase,
    reviewId: string
): Promise<{ data?: typeof reviews.$inferSelect; error?: string; success: boolean }> => {
    try {
        const result = await db
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .get();

        if (!result) {
            return { error: 'Review not found', success: false };
        }

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting review by id:', error);
        return {
            error: error.message || 'Failed to retrieve review',
            success: false,
        };
    }
};

/**
 * Delete a review by ID - INTERNAL USE ONLY
 * 
 * WARNING: This function is intentionally NOT exposed via API routes.
 * Deleting a review without properly updating the annotation and task state
 * would leave the system in an inconsistent state.
 * 
 * If review deletion is needed in the future, it must:
 * 1. Recalculate the annotation's reviewStatus based on remaining reviews
 * 2. Update the task status accordingly
 * 3. Handle the case where it's the only review (revert to in_review state?)
 * 4. Be restricted to admin users only
 * 
 * For now, reviews are considered immutable after creation.
 * Use updateReview to change the status of a pending review instead.
 */
export const _deleteReviewInternal = async (
    db: LibSQLDatabase,
    reviewId: string
): Promise<{ data?: typeof reviews.$inferSelect; error?: string; success: boolean }> => {
    try {
        const existingReview = await db
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .get();

        if (!existingReview) {
            return { error: 'Review not found', success: false };
        }

        // TODO: Add proper state management here if this function is ever used
        // - Recalculate annotation.reviewStatus
        // - Update task.status
        // - Handle review round logic

        const result = await db
            .delete(reviews)
            .where(eq(reviews.id, reviewId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error deleting review:', error);
        return {
            error: error.message || 'Failed to delete review',
            success: false,
        };
    }
};

/**
 * Get review statistics for a project
 */
export const getProjectReviewStats = async (
    db: LibSQLDatabase,
    projectId: number
): Promise<{
    data?: {
        total: number;
        pending: number;
        approved: number;
        rejected: number;
        changesRequested: number;
    };
    error?: string;
    success: boolean;
}> => {
    try {
        const stats = await db
            .select({
                status: reviews.status,
                count: sql<number>`count(*)`,
            })
            .from(reviews)
            .where(eq(reviews.projectId, projectId))
            .groupBy(reviews.status)
            .all();

        const result = {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            changesRequested: 0,
        };

        for (const stat of stats) {
            result.total += stat.count;
            switch (stat.status) {
                case 'pending':
                    result.pending = stat.count;
                    break;
                case 'approved':
                    result.approved = stat.count;
                    break;
                case 'rejected':
                    result.rejected = stat.count;
                    break;
                case 'changes_requested':
                    result.changesRequested = stat.count;
                    break;
            }
        }

        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting project review stats:', error);
        return {
            error: error.message || 'Failed to retrieve review statistics',
            success: false,
        };
    }
};
