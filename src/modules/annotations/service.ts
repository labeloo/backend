import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { annotations, users, tasks, reviews } from '../../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { determineWorkflowMode } from '../reviews/workflow';

// Types for completeAnnotation return
export interface CompleteAnnotationResult {
    requiresReview: boolean;
    review?: typeof reviews.$inferSelect;
    assignedReviewer?: number;
}

// Helper to generate unique review ID
const generateReviewId = (): string => {
    return `rev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

//get all annotations with userId
export const getAnnotations = async (
    db: LibSQLDatabase,
    userId: number
) => {
    try {
        const result = await db
            .select()
            .from(annotations)
            .where(eq(annotations.userId, userId))
            .orderBy(desc(annotations.createdAt))
            .all();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting annotations:', error);
        return { error: error.message || 'Failed to retrieve annotations', success: false };
    }
}

//get annotation by id
export const getAnnotationById = async (
    db: LibSQLDatabase,
    userId: number,
    id: number
) => {
    try {
        const result = await db
            .select()
            .from(annotations)
            .where(and(eq(annotations.userId, userId), eq(annotations.id, id)))
            .get();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting annotation by id:', error);
        return { error: error.message || 'Failed to retrieve annotation', success: false };
    }
}

//Create annotation
export const createAnnotation = async (
    db: LibSQLDatabase,
    body: typeof annotations.$inferInsert
) => {
    try {
        const result = await db
            .insert(annotations)
            .values({
                taskId: body.taskId,
                userId: body.userId,
                projectId: body.projectId,
                annotationData: body.annotationData,
                isGroundTruth: body.isGroundTruth,
                reviewStatus: body.reviewStatus,
                assignedReviewerId: body.assignedReviewerId,  
            })
            .returning()
            .get();
        return { data: result, success: true };
    } catch (error) {
        console.error('Error creating annotation:', error);
        return { error: error.message || 'Failed to create annotation', success: false };
    }
}

//get annotations by task id
export const getAnnotationsByTaskId = async (
    db: LibSQLDatabase,
    taskId: number
) => {
    try {
        const result = await db
            .select({
                id: annotations.id,
                taskId: annotations.taskId,
                userId: annotations.userId,
                projectId: annotations.projectId,
                annotationData: annotations.annotationData,
                isGroundTruth: annotations.isGroundTruth,
                reviewStatus: annotations.reviewStatus,
                assignedReviewerId: annotations.assignedReviewerId,
                createdAt: annotations.createdAt,
                updatedAt: annotations.updatedAt,
                // Join with users table to get user email for annotator
                userEmail: users.email
            })
            .from(annotations)
            .leftJoin(users, eq(annotations.userId, users.id))
            .where(eq(annotations.taskId, taskId))
            .orderBy(desc(annotations.createdAt))
            .all();
        
        return { data: result, success: true };
    } catch (error) {
        console.error('Error getting annotations by task id:', error);
        return { error: error.message || 'Failed to retrieve annotations for task', success: false };
    }
};

//Update annotation

//delete annotation
export const deleteAnnotation = async (
    db: LibSQLDatabase,
    userId: number,
    annotationId: number
) => {
    try {
        // First check if the annotation exists and belongs to the user
        const existingAnnotation = await db
            .select()
            .from(annotations)
            .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
            .get();
        
        if (!existingAnnotation) {
            return { error: 'Annotation not found or you do not have permission to delete it', success: false };
        }
        
        // Delete the annotation
        const result = await db
            .delete(annotations)
            .where(eq(annotations.id, annotationId))
            .returning()
            .get();
        
        return { data: result, success: true };
    } catch (error) {
        console.error('Error deleting annotation:', error);
        return { error: error.message || 'Failed to delete annotation', success: false };
    }
};

/**
 * Complete an annotation and determine if it requires review or auto-approval
 * 
 * Logic:
 * 1. Fetch the annotation and related task
 * 2. Call determineWorkflowMode to check workflow settings
 * 3. If auto-approve: complete task, approve annotation, create auto-approved review
 * 4. If review-required: set task to in_review, create pending review with assigned reviewer
 */
export const completeAnnotation = async (
    db: LibSQLDatabase,
    annotationId: number,
    userId: number
): Promise<{ data?: CompleteAnnotationResult; error?: string; success: boolean }> => {
    try {
        // 1. Fetch the annotation
        const annotation = await db
            .select()
            .from(annotations)
            .where(eq(annotations.id, annotationId))
            .get();

        if (!annotation) {
            return { error: 'Annotation not found', success: false };
        }

        // Verify the user owns this annotation
        if (annotation.userId !== userId) {
            return { error: 'You do not have permission to complete this annotation', success: false };
        }

        // GUARD: Prevent duplicate completion
        // Only annotations with 'pending' status can be completed
        // This prevents duplicate reviews from being created if called twice
        if (annotation.reviewStatus !== 'pending') {
            return { 
                error: `Annotation already completed with status: ${annotation.reviewStatus}`, 
                success: false 
            };
        }

        // 2. Fetch the related task
        const task = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, annotation.taskId))
            .get();

        if (!task) {
            return { error: 'Related task not found', success: false };
        }

        // Also guard on task status - should be 'annotating' or 'changes_needed' to complete
        if (task.status !== 'annotating' && task.status !== 'changes_needed') {
            return { 
                error: `Task is not in a completable state. Current status: ${task.status}`, 
                success: false 
            };
        }

        const now = Math.floor(Date.now() / 1000);
        const reviewId = generateReviewId();

        // Compute the next review round (handles resubmissions after changes_requested)
        const lastRound = await db
            .select({ max: sql<number>`max(review_round)` })
            .from(reviews)
            .where(eq(reviews.annotationId, annotationId))
            .get();
        
        const nextRound = (lastRound?.max ?? 0) + 1;

        // 3. Determine workflow mode
        const workflow = await determineWorkflowMode(db, annotation.projectId, userId);

        if (workflow.mode === 'auto-approve') {
            // AUTO-APPROVE FLOW
            // - Update task status to 'completed'
            // - Update annotation review_status to 'approved', reviewer_id to userId
            // - Create a review record with is_auto_approved = true

            await db.batch([
                // Update task to completed
                db.update(tasks)
                    .set({
                        status: 'completed',
                        updatedAt: now,
                    })
                    .where(eq(tasks.id, annotation.taskId)),

                // Update annotation to approved (no assigned reviewer needed for auto-approve)
                db.update(annotations)
                    .set({
                        reviewStatus: 'approved',
                        assignedReviewerId: null, // Clear assignment since it's auto-approved
                        updatedAt: now,
                    })
                    .where(eq(annotations.id, annotationId)),

                // Create auto-approved review record (reviewerId in reviews table = who performed review)
                db.insert(reviews).values({
                    id: reviewId,
                    annotationId: annotationId,
                    taskId: annotation.taskId,
                    projectId: annotation.projectId,
                    reviewerId: userId, // The user who triggered auto-approval
                    status: 'approved',
                    message: null,
                    isAutoApproved: true,
                    reviewRound: nextRound,
                    createdAt: now,
                    updatedAt: now,
                }),
            ]);

            // Fetch the created review
            const createdReview = await db
                .select()
                .from(reviews)
                .where(eq(reviews.id, reviewId))
                .get();

            return {
                data: {
                    requiresReview: false,
                    review: createdReview,
                },
                success: true,
            };
        } else {
            // REVIEW-REQUIRED FLOW
            // - Update task status to 'in_review'
            // - Update annotation review_status to 'pending'
            // - If assignedReviewer exists, create a pending review record

            // First batch: update task and annotation
            await db.batch([
                // Update task to in_review
                db.update(tasks)
                    .set({
                        status: 'in_review',
                        updatedAt: now,
                    })
                    .where(eq(tasks.id, annotation.taskId)),

                // Update annotation to pending review with assigned reviewer
                db.update(annotations)
                    .set({
                        reviewStatus: 'pending',
                        assignedReviewerId: workflow.assignedReviewer ?? null,
                        updatedAt: now,
                    })
                    .where(eq(annotations.id, annotationId)),
            ]);

            // If a reviewer was auto-assigned, create a pending review record
            if (workflow.assignedReviewer) {
                await db.insert(reviews).values({
                    id: reviewId,
                    annotationId: annotationId,
                    taskId: annotation.taskId,
                    projectId: annotation.projectId,
                    reviewerId: workflow.assignedReviewer, // Who is assigned to review
                    status: 'pending',
                    message: null,
                    isAutoApproved: false,
                    reviewRound: nextRound,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            return {
                data: {
                    requiresReview: true,
                    assignedReviewer: workflow.assignedReviewer,
                },
                success: true,
            };
        }
    } catch (error) {
        console.error('Error completing annotation:', error);
        return {
            error: error.message || 'Failed to complete annotation',
            success: false,
        };
    }
};
