import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { annotations,users } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';

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
                reviewerId: body.reviewerId,  
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
                reviewerId: annotations.reviewerId,
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
export const updateAnnotation = async (
    db: LibSQLDatabase,
    userId: number,
    annotationId: number,
    updates: Partial<typeof annotations.$inferInsert>
) => {
    try {
        // Only the annotation's owner may edit it.
        const existing = await db
            .select()
            .from(annotations)
            .where(
                and(
                    eq(annotations.id, annotationId),
                    eq(annotations.userId, userId)
                )
            )
            .get();

        if (!existing) {
            return {
                error: 'Annotation not found or you do not have permission to update it',
                success: false,
                notFound: true,
            };
        }

        // Whitelist updatable fields — never let taskId/projectId/userId move.
        const allowed: Partial<typeof annotations.$inferInsert> = {
            updatedAt: Math.floor(Date.now() / 1000),
        };
        if (updates.annotationData !== undefined)
            allowed.annotationData = updates.annotationData;
        if (updates.isGroundTruth !== undefined)
            allowed.isGroundTruth = updates.isGroundTruth;
        if (updates.reviewStatus !== undefined)
            allowed.reviewStatus = updates.reviewStatus;
        if (updates.reviewerId !== undefined)
            allowed.reviewerId = updates.reviewerId;

        const result = await db
            .update(annotations)
            .set(allowed)
            .where(eq(annotations.id, annotationId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error) {
        console.error('Error updating annotation:', error);
        return {
            error: error.message || 'Failed to update annotation',
            success: false,
        };
    }
};

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
