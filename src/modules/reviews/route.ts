import { Hono } from 'hono';
import type { Variables } from '../../types';
import { eq, and, desc } from 'drizzle-orm';
import {
    annotations,
    projects,
    reviews,
    projectRelations,
    projectRoles,
    tasks,
} from '../../db/schema';
import {
    createReview,
    updateReview,
    getReviewsByAnnotation,
    getReviewsByProject,
    getReviewsAssignedToUser,
    getReviewById,
} from './service';
import {
    createReviewSchema,
    updateReviewSchema,
    reviewQuerySchema,
} from './schemas';
import { canUserReview } from './workflow';
import { checkProjectPermission } from '../../utils';

const app = new Hono<{ Variables: Variables }>();

// Helper to check if user has a specific project permission (returns boolean, doesn't throw)
const hasProjectPermission = async (
    db: any,
    userId: number,
    projectId: number,
    flag: 'reviewAnnotations' | 'viewReviews' | 'editProject'
): Promise<boolean> => {
    try {
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
        return permissions.permissionFlags?.[flag] === true;
    } catch {
        return false;
    }
};

// Helper to check if user is the annotator of an annotation
const isAnnotator = async (
    db: any,
    annotationId: number,
    userId: number
): Promise<boolean> => {
    const annotation = await db
        .select({ userId: annotations.userId })
        .from(annotations)
        .where(eq(annotations.id, annotationId))
        .get();
    
    return annotation?.userId === userId;
};

// ============================================================================
// POST /api/projects/:projectId/annotations/:annotationId/reviews
// Create a new review for an annotation
// ============================================================================
app.post('/projects/:projectId/annotations/:annotationId/reviews', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));
        const annotationId = Number(c.req.param('annotationId'));

        if (!projectId || isNaN(projectId)) {
            return c.json({ error: 'Invalid project ID' }, 400);
        }
        if (!annotationId || isNaN(annotationId)) {
            return c.json({ error: 'Invalid annotation ID' }, 400);
        }

        // Check reviewAnnotations permission
        const hasPermission = await hasProjectPermission(db, userId, projectId, 'reviewAnnotations');
        if (!hasPermission) {
            return c.json({ error: 'You do not have permission to review annotations' }, 403);
        }

        // Fetch the annotation to get task info and check state
        const annotation = await db
            .select()
            .from(annotations)
            .where(
                and(
                    eq(annotations.id, annotationId),
                    eq(annotations.projectId, projectId)
                )
            )
            .get();

        if (!annotation) {
            return c.json({ error: 'Annotation not found' }, 404);
        }

        // FIX #1: Validate annotation state - cannot review finalized annotations
        // Rejected annotations require re-submission before new review (handled by task state)
        if (annotation.reviewStatus === 'approved' || annotation.reviewStatus === 'rejected') {
            return c.json({ 
                error: 'This annotation is already finalized. Rejected annotations require re-submission.',
                status: annotation.reviewStatus
            }, 400);
        }

        // Fetch the task to check its state
        const task = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, annotation.taskId))
            .get();

        if (!task) {
            return c.json({ error: 'Related task not found' }, 404);
        }

        // Annotation should be in 'in_review' or 'changes_needed' state to be reviewed
        if (task.status !== 'in_review' && task.status !== 'changes_needed') {
            return c.json({ 
                error: 'This annotation is not ready for review. Task must be in "in_review" or "changes_needed" state.',
                currentStatus: task.status 
            }, 400);
        }

        // FIX #1: Check if there's already a pending review for this round
        // Get the latest review for this annotation
        const latestReview = await db
            .select()
            .from(reviews)
            .where(eq(reviews.annotationId, annotationId))
            .orderBy(desc(reviews.reviewRound))
            .limit(1)
            .get();

        // If there's already a pending review, don't allow creating another
        if (latestReview && latestReview.status === 'pending') {
            return c.json({ 
                error: 'A pending review already exists for this annotation',
                existingReviewId: latestReview.id
            }, 400);
        }

        // FIX #2: Check if this user is the assigned reviewer (if one exists)
        // If annotation has an assigned reviewer, only that reviewer can review
        // assignedReviewerId = who is assigned to review (stable assignment)
        // reviews.reviewerId = who actually performed the review (historical)
        if (annotation.assignedReviewerId && annotation.assignedReviewerId !== userId) {
            return c.json({ 
                error: 'This annotation is assigned to another reviewer',
            }, 403);
        }

        // Check if self-review is allowed
        const reviewCheck = await canUserReview(db, projectId, userId, annotation.userId);
        if (!reviewCheck.canReview) {
            return c.json({ error: reviewCheck.reason }, 403);
        }

        // Parse and validate request body
        const body = await c.req.json();
        const validation = createReviewSchema.safeParse(body);

        if (!validation.success) {
            return c.json({
                error: 'Validation failed',
                details: validation.error.errors,
            }, 400);
        }

        const { status, message, notifyAnnotator } = validation.data;

        // Create the review
        const result = await createReview(db, {
            annotationId,
            taskId: annotation.taskId,
            projectId,
            reviewerId: userId,
            status,
            message: message ?? undefined,
        });

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        // TODO: If notifyAnnotator is true, send notification to annotator
        // This would integrate with a notification system

        return c.json({ data: result.data }, 201);
    } catch (error) {
        console.error('Error creating review:', error);
        return c.json({ error: 'Failed to create review', details: error.message }, 500);
    }
});

// ============================================================================
// GET /api/projects/:projectId/annotations/:annotationId/reviews
// Get all reviews for an annotation
// ============================================================================
app.get('/projects/:projectId/annotations/:annotationId/reviews', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));
        const annotationId = Number(c.req.param('annotationId'));

        if (!projectId || isNaN(projectId)) {
            return c.json({ error: 'Invalid project ID' }, 400);
        }
        if (!annotationId || isNaN(annotationId)) {
            return c.json({ error: 'Invalid annotation ID' }, 400);
        }

        // Check if user has viewReviews permission OR is the annotator
        const hasViewPermission = await hasProjectPermission(db, userId, projectId, 'viewReviews');
        const isUserAnnotator = await isAnnotator(db, annotationId, userId);

        if (!hasViewPermission && !isUserAnnotator) {
            return c.json({ error: 'You do not have permission to view these reviews' }, 403);
        }

        // Check that annotation belongs to project
        const annotation = await db
            .select({ id: annotations.id })
            .from(annotations)
            .where(
                and(
                    eq(annotations.id, annotationId),
                    eq(annotations.projectId, projectId)
                )
            )
            .get();

        if (!annotation) {
            return c.json({ error: 'Annotation not found in this project' }, 404);
        }

        const result = await getReviewsByAnnotation(db, annotationId);

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        return c.json({ data: result.data }, 200);
    } catch (error) {
        console.error('Error getting reviews:', error);
        return c.json({ error: 'Failed to retrieve reviews', details: error.message }, 500);
    }
});

// ============================================================================
// PATCH /api/projects/:projectId/reviews/:reviewId
// Update an existing review
// ============================================================================
app.patch('/projects/:projectId/reviews/:reviewId', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));
        const reviewId = c.req.param('reviewId');

        if (!projectId || isNaN(projectId)) {
            return c.json({ error: 'Invalid project ID' }, 400);
        }
        if (!reviewId) {
            return c.json({ error: 'Review ID is required' }, 400);
        }

        // Check reviewAnnotations permission
        const hasPermission = await hasProjectPermission(db, userId, projectId, 'reviewAnnotations');
        if (!hasPermission) {
            return c.json({ error: 'You do not have permission to update reviews' }, 403);
        }

        // Fetch the review and verify ownership
        const existingReview = await db
            .select()
            .from(reviews)
            .where(
                and(
                    eq(reviews.id, reviewId),
                    eq(reviews.projectId, projectId)
                )
            )
            .get();

        if (!existingReview) {
            return c.json({ error: 'Review not found' }, 404);
        }

        // FIX #2: The reviewer ownership check is correct, but let's also add state validation
        // Only the original reviewer can update the review
        if (existingReview.reviewerId !== userId) {
            return c.json({ error: 'You can only update your own reviews' }, 403);
        }

        // Cannot update a review that has already been finalized (approved/rejected/changes_requested)
        // Only pending reviews can be updated (this is the reviewer submitting their decision)
        // If the review is already decided, they should create a new review round instead
        if (existingReview.status !== 'pending') {
            return c.json({ 
                error: 'Cannot update a finalized review. The annotation must go through another review round.',
                currentStatus: existingReview.status
            }, 400);
        }

        // Parse and validate request body
        const body = await c.req.json();
        const validation = updateReviewSchema.safeParse(body);

        if (!validation.success) {
            return c.json({
                error: 'Validation failed',
                details: validation.error.errors,
            }, 400);
        }

        const result = await updateReview(db, reviewId, validation.data);

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        return c.json({ data: result.data }, 200);
    } catch (error) {
        console.error('Error updating review:', error);
        return c.json({ error: 'Failed to update review', details: error.message }, 500);
    }
});

// ============================================================================
// GET /api/projects/:projectId/reviews
// Get paginated reviews for a project with optional filters
// ============================================================================
app.get('/projects/:projectId/reviews', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));

        if (!projectId || isNaN(projectId)) {
            return c.json({ error: 'Invalid project ID' }, 400);
        }

        // Check viewReviews permission
        const hasPermission = await hasProjectPermission(db, userId, projectId, 'viewReviews');
        if (!hasPermission) {
            return c.json({ error: 'You do not have permission to view reviews' }, 403);
        }

        // Parse and validate query params
        const queryParams = {
            status: c.req.query('status'),
            reviewerId: c.req.query('reviewerId'),
            page: c.req.query('page'),
            limit: c.req.query('limit'),
        };

        const validation = reviewQuerySchema.safeParse(queryParams);

        if (!validation.success) {
            return c.json({
                error: 'Invalid query parameters',
                details: validation.error.errors,
            }, 400);
        }

        const { status, reviewerId, page, limit } = validation.data;

        const result = await getReviewsByProject(db, projectId, {
            status,
            reviewerId: reviewerId ? Number(reviewerId) : undefined,
            page,
            limit,
        });

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        return c.json({ data: result.data }, 200);
    } catch (error) {
        console.error('Error getting project reviews:', error);
        return c.json({ error: 'Failed to retrieve reviews', details: error.message }, 500);
    }
});

// ============================================================================
// GET /api/projects/:projectId/reviews/assigned-to-me
// Get pending reviews assigned to the current user
// ============================================================================
app.get('/projects/:projectId/reviews/assigned-to-me', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));

        if (!projectId || isNaN(projectId)) {
            return c.json({ error: 'Invalid project ID' }, 400);
        }

        // User must be a member of the project (check any permission)
        const isMember = await db
            .select({ id: projectRelations.id })
            .from(projectRelations)
            .where(
                and(
                    eq(projectRelations.userId, userId),
                    eq(projectRelations.projectId, projectId)
                )
            )
            .get();

        if (!isMember) {
            return c.json({ error: 'You are not a member of this project' }, 403);
        }

        const result = await getReviewsAssignedToUser(db, userId, projectId);

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        return c.json({ data: result.data }, 200);
    } catch (error) {
        console.error('Error getting assigned reviews:', error);
        return c.json({ error: 'Failed to retrieve assigned reviews', details: error.message }, 500);
    }
});

// ============================================================================
// GET /api/reviews/assigned-to-me (global - across all projects)
// Get all pending reviews assigned to the current user
// ============================================================================
app.get('/reviews/assigned-to-me', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        const result = await getReviewsAssignedToUser(db, userId);

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        return c.json({ data: result.data }, 200);
    } catch (error) {
        console.error('Error getting assigned reviews:', error);
        return c.json({ error: 'Failed to retrieve assigned reviews', details: error.message }, 500);
    }
});

export default app;
