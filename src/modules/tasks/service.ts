import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { eq, and, desc, isNull, not, gt, or } from 'drizzle-orm';
import { tasks, projects, users, annotations, organizationRelations, organizationRoles, projectRelations, projectRoles } from '../../db/schema';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import { imageSize } from '../../imageSize';
import { resolveInsideRoot } from '../../utils';

type SplitConfig = {
    train: number;
    test: number;
    validation: number;
};

// Helper function to check if user is admin in organization
const isUserOrgAdmin = async (db: LibSQLDatabase, userId: number, organizationId: number): Promise<boolean> => {
    try {
        const permissions = await db
            .select({ permissionFlags: organizationRoles.permissionFlags })
            .from(organizationRelations)
            .where(
                and(
                    eq(organizationRelations.userId, userId),
                    eq(organizationRelations.organizationId, organizationId)
                )
            )
            .innerJoin(
                organizationRoles,
                eq(organizationRoles.id, organizationRelations.roleId)
            )
            .get();

        return permissions?.permissionFlags.admin === true;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
};

// Reusable permission checker helper function
const checkTaskManagementPermissions = async (
    db: LibSQLDatabase, 
    userId: number, 
    projectId?: number, 
    organizationId?: number
) => {
    try {
        let isOrgAdmin = false;
        let hasProjectEditPermission = false;

        // First check organization admin permission (if organizationId provided)
        if (organizationId) {
            const orgPermissions = await db
                .select({ permissionFlags: organizationRoles.permissionFlags })
                .from(organizationRelations)
                .where(
                    and(
                        eq(organizationRelations.userId, userId),
                        eq(organizationRelations.organizationId, organizationId)
                    )
                )
                .innerJoin(
                    organizationRoles,
                    eq(organizationRoles.id, organizationRelations.roleId)
                )
                .get();

            isOrgAdmin = orgPermissions?.permissionFlags.admin === true;
        }

        // Then check project edit permission (if projectId provided and not already org admin)
        if (!isOrgAdmin && projectId) {
            const projectPermissions = await db
                .select({ permissionFlags: projectRoles.permissionFlags })
                .from(projectRelations)
                .where(
                    and(
                        eq(projectRelations.userId, userId),
                        eq(projectRelations.projectId, projectId)
                    )
                )
                .innerJoin(
                    projectRoles,
                    eq(projectRoles.id, projectRelations.roleId)
                )
                .get();

            hasProjectEditPermission = projectPermissions?.permissionFlags.editProject === true;
        }

        return {
            isOrgAdmin,
            hasProjectEditPermission,
            canManageTasks: isOrgAdmin || hasProjectEditPermission
        };
    } catch (error) {
        console.error('Error checking task management permissions:', error);
        return {
            isOrgAdmin: false,
            hasProjectEditPermission: false,
            canManageTasks: false
        };
    }
};

// Helper function to validate task update permissions
export const validateTaskUpdatePermissions = async (
    db: LibSQLDatabase,
    userId: number,
    taskIds: number | number[],
    updates: any
) => {
    try {
        // Normalize taskIds to array
        const taskIdArray = Array.isArray(taskIds) ? taskIds : [taskIds];

        // Get all tasks being updated
        const tasksToUpdate = await db
            .select({
                id: tasks.id,
                projectId: tasks.projectId,
                assignedTo: tasks.assignedTo,
                status: tasks.status
            })
            .from(tasks)
            .where(or(...taskIdArray.map(id => eq(tasks.id, id))));

        if (tasksToUpdate.length !== taskIdArray.length) {
            return {
                success: false,
                error: 'One or more tasks not found'
            };
        }

        // Verify all tasks belong to the same project
        const uniqueProjectIds = [...new Set(tasksToUpdate.map(task => task.projectId))];
        if (uniqueProjectIds.length > 1) {
            return {
                success: false,
                error: 'All tasks must belong to the same project for batch updates'
            };
        }

        const projectId = uniqueProjectIds[0];

        // Get project's organizationId
        const project = await db
            .select({ organizationId: projects.organizationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .get();

        if (!project) {
            return {
                success: false,
                error: 'Project not found'
            };
        }

        // Check permissions using the helper
        const permissions = await checkTaskManagementPermissions(
            db,
            userId,
            projectId,
            project.organizationId
        );

        // If user has management permissions, allow unconditionally
        if (permissions.canManageTasks) {
            return { success: true };
        }

        // If no management permissions, check if user can complete their own work
        const allTasksAssignedToUser = tasksToUpdate.every(task => task.assignedTo === userId);
        const isCompletionUpdate = updates.status === 'completed' && Object.keys(updates).length === 1;

        if (allTasksAssignedToUser && isCompletionUpdate) {
            return { success: true };
        }

        // Otherwise, deny access
        return {
            success: false,
            error: 'You need editProject permission or organization admin access to manage tasks in this project'
        };

    } catch (error) {
        console.error('Error validating task update permissions:', error);
        return {
            success: false,
            error: 'Failed to validate permissions'
        };
    }
};

// Helper function to validate dataset export permissions
export const validateDatasetExportPermissions = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
) => {
    try {
        // Get project's organizationId
        const project = await db
            .select({ organizationId: projects.organizationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .get();

        if (!project) {
            return {
                success: false,
                error: 'Project not found'
            };
        }

        // Check permissions using the helper
        const permissions = await checkTaskManagementPermissions(
            db,
            userId,
            projectId,
            project.organizationId
        );

        // Allow export if user has management permissions (org admin OR project edit permission)
        if (permissions.canManageTasks) {
            return { success: true };
        }

        // Otherwise, deny access
        return {
            success: false,
            error: 'Dataset export requires editProject permission or organization admin access'
        };

    } catch (error) {
        console.error('Error validating dataset export permissions:', error);
        return {
            success: false,
            error: 'Failed to validate export permissions'
        };
    }
};

// Helper function to validate single task operation permissions
export const validateSingleTaskOperationPermissions = async (
    db: LibSQLDatabase,
    userId: number,
    taskId: number,
    operation: 'assign' | 'unassign' | 'complete'
) => {
    try {
        // Get the task with its project information
        const taskWithProject = await db
            .select({
                taskId: tasks.id,
                taskProjectId: tasks.projectId,
                taskAssignedTo: tasks.assignedTo,
                projectOrganizationId: projects.organizationId
            })
            .from(tasks)
            .innerJoin(projects, eq(tasks.projectId, projects.id))
            .where(eq(tasks.id, taskId))
            .get();

        if (!taskWithProject) {
            return {
                success: false,
                error: 'Task not found'
            };
        }

        // Check permissions using the helper
        const permissions = await checkTaskManagementPermissions(
            db,
            userId,
            taskWithProject.taskProjectId,
            taskWithProject.projectOrganizationId
        );

        // Allow operation if user has management permissions (org admin OR project edit permission)
        if (permissions.canManageTasks) {
            return { success: true };
        }

        // Special exception for complete operation: allow users to complete their own assigned tasks
        if (operation === 'complete' && taskWithProject.taskAssignedTo === userId) {
            return { success: true };
        }

        // Otherwise, deny access
        return {
            success: false,
            error: 'You need editProject permission or organization admin access to manage tasks in this project'
        };

    } catch (error) {
        console.error('Error validating single task operation permissions:', error);
        return {
            success: false,
            error: 'Failed to validate permissions'
        };
    }
};

// Helper function to get actual image dimensions from file
const getImageDimensions = async (imagePath: string): Promise<{ width: number; height: number } | null> => {
    try {
        if (!fs.existsSync(imagePath)) {
            console.warn(`Image file not found: ${imagePath}`);
            return null;
        }
        
        const size = imageSize(new Uint8Array(await fs.promises.readFile(imagePath)));
        if (size) return size;
        
        console.warn(`Could not read dimensions from image: ${imagePath}`);
        return null;
    } catch (error) {
        console.error(`Error reading image dimensions from ${imagePath}:`, error);
        return null;
    }
};

// Helper function to resolve image path using UUID from task metadata
const resolveImagePathFromUUID = (task: any): string | null => {
    try {
        if (!task.metadata || !task.metadata.uuid || !task.metadata.originalFileName) {
            console.log('Missing UUID or originalFileName in task metadata');
            return null;
        }
        
        // Extract project ID from the task's dataUrl
        // Example: "http://localhost:8787/api/bucket/taskData/22/uuid.jpg"
        const projectIdMatch = task.dataUrl.match(/\/(\d+)\//);
        if (!projectIdMatch) {
            console.log('Could not extract project ID from dataUrl:', task.dataUrl);
            return null;
        }
        
        const projectId = parseInt(projectIdMatch[1]);
        const uuid = task.metadata.uuid;
        const extension = path.extname(task.metadata.originalFileName);
        
        // Construct path: bucket/projects/{projectId}/{uuid}{extension}
        const filename = `${uuid}${extension}`;
        const fullPath = path.join(process.cwd(), 'bucket', 'projects', projectId.toString(), filename);
        
        console.log(`Resolving image path from UUID: projectId=${projectId}, uuid=${uuid}, originalFileName=${task.metadata.originalFileName} -> ${fullPath}`);
        return fullPath;
    } catch (error) {
        console.error(`Error resolving image path from UUID:`, error);
        return null;
    }
};

// Helper function to resolve image path from dataUrl (fallback)
const resolveImagePath = (dataUrl: string): string | null => {
    try {
        // Extract relative path from the dataUrl
        // Example: "http://localhost:8787/api/upload/projects/22/image.jpg" 
        // Should resolve to: "./bucket/projects/22/image.jpg"
        
        const url = new URL(dataUrl);
        const urlPath = url.pathname;
        
        // Remove /api/upload prefix to get the bucket path
        const bucketPath = urlPath.replace('/api/upload/', '');
        const fullPath = path.join(process.cwd(), 'bucket', bucketPath);
        
        console.log(`Resolving image path: ${dataUrl} -> ${fullPath}`);
        return fullPath;
    } catch (error) {
        console.error(`Error resolving image path from ${dataUrl}:`, error);
        return null;
    }
};
// Get all tasks for a project
export const getTasksByProject = async (db: LibSQLDatabase, projectId: number, userId: number) => {
    try {
        const allTasks = await db
            .select({
                id: tasks.id,
                projectId: tasks.projectId,
                dataUrl: tasks.dataUrl,
                dataType: tasks.dataType,
                status: tasks.status,
                assignedTo: tasks.assignedTo,
                metadata: tasks.metadata,
                priority: tasks.priority,
                createdAt: tasks.createdAt,
                updatedAt: tasks.updatedAt,
            })
            .from(tasks)
            .where(eq(tasks.projectId, projectId))
            .orderBy(desc(tasks.priority), desc(tasks.createdAt));

        // Group tasks by status
        const groupedTasks = {
            unassigned: allTasks.filter(task => task.status === 'unassigned'),
            annotating: allTasks.filter(task => task.status === 'annotating'),
            completed: allTasks.filter(task => task.status === 'completed')
        };

        return { data: groupedTasks, success: true };
    } catch (error: any) {
        console.error('Error getting tasks by project:', error);
        return { error: error.message || 'Failed to retrieve tasks', success: false };
    }
};

// Get tasks assigned to a specific user (with three-tier permission system)
export const getTasksByUser = async (db: LibSQLDatabase, userId: number, projectId?: number, organizationId?: number) => {
    try {
        let whereCondition;

        // Use the reusable permission checker
        const permissionCheck = await checkTaskManagementPermissions(db, userId, projectId, organizationId);

        // Determine query condition based on permission tiers
        if (permissionCheck.isOrgAdmin) {
            // Org admin sees all tasks (optionally filtered by project)
            whereCondition = projectId ? eq(tasks.projectId, projectId) : undefined;
        } else if (permissionCheck.hasProjectEditPermission && projectId) {
            // Project editor sees all tasks within that specific project
            whereCondition = eq(tasks.projectId, projectId);
        } else {
            // Regular users see only their assigned tasks
            whereCondition = projectId
                ? and(eq(tasks.assignedTo, userId), eq(tasks.projectId, projectId))
                : eq(tasks.assignedTo, userId);
        }

        const result = await db
            .select({
                id: tasks.id,
                projectId: tasks.projectId,
                dataUrl: tasks.dataUrl,
                dataType: tasks.dataType,
                status: tasks.status,
                assignedTo: tasks.assignedTo,
                metadata: tasks.metadata,
                priority: tasks.priority,
                createdAt: tasks.createdAt,
                updatedAt: tasks.updatedAt,
            })
            .from(tasks)
            .where(whereCondition)
            .orderBy(desc(tasks.priority), desc(tasks.createdAt));

        // Build comprehensive permissions object
        const permissions = {
            isOrgAdmin: permissionCheck.isOrgAdmin,
            canEditProject: permissionCheck.hasProjectEditPermission,
            canAssignTasks: permissionCheck.canManageTasks,
            canViewAllTasks: permissionCheck.canManageTasks,
            canExportDataset: permissionCheck.canManageTasks
        };

        return { 
            data: result, 
            success: true,
            permissions
        };
    } catch (error: any) {
        console.error('Error getting tasks by user:', error);
        return { error: error.message || 'Failed to retrieve user tasks', success: false };
    }
};

// Get unassigned tasks (task pool)
export const getUnassignedTasks = async (db: LibSQLDatabase, projectId: number) => {
    try {
        const result = await db
            .select({
                id: tasks.id,
                projectId: tasks.projectId,
                dataUrl: tasks.dataUrl,
                dataType: tasks.dataType,
                status: tasks.status,
                assignedTo: tasks.assignedTo,
                metadata: tasks.metadata,
                priority: tasks.priority,
                createdAt: tasks.createdAt,
                updatedAt: tasks.updatedAt,
            })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.assignedTo)))
            .orderBy(desc(tasks.priority), desc(tasks.createdAt));

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error getting unassigned tasks:', error);
        return { error: error.message || 'Failed to retrieve unassigned tasks', success: false };
    }
};

// Get task by ID
export const getTaskById = async (db: LibSQLDatabase, taskId: number) => {
    try {
        const task = await db
            .select({
                id: tasks.id,
                projectId: tasks.projectId,
                dataUrl: tasks.dataUrl,
                dataType: tasks.dataType,
                status: tasks.status,
                assignedTo: tasks.assignedTo,
                metadata: tasks.metadata,
                priority: tasks.priority,
                createdAt: tasks.createdAt,
                updatedAt: tasks.updatedAt,
            })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .get();

        if (!task) {
            throw new Error(`Task with ID ${taskId} not found`);
        }
        const nextTask = await db
            .select({
                id: tasks.id
            })
            .from(tasks)
            .where(
                and(
                    eq(tasks.projectId, task.projectId),
                    eq(tasks.status, 'annotating'),
                    gt(tasks.id, taskId)
                )
            )
            .orderBy(desc(tasks.priority), desc(tasks.createdAt))
            .limit(1)
            .get();

        const result = {
            ...task,
            nextTaskId: nextTask ? nextTask.id : null
        }

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error getting task by ID:', error);
        return { error: error.message || 'Failed to retrieve task', success: false };
    }
};

// Create a new task
export const createTask = async (
    db: LibSQLDatabase,
    projectId: number,
    dataUrl: string,
    dataType: string,
    metadata?: any,
    priority?: number
) => {
    try {
        const result = await db
            .insert(tasks)
            .values({
                projectId,
                dataUrl,
                dataType: JSON.stringify(dataType),
                metadata: metadata ? JSON.stringify(metadata) : null,
                status: 'unassigned',
                priority: priority || 0,
            })
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error creating task:', error);
        return { error: error.message || 'Failed to create task', success: false };
    }
};

// Update task
export const updateTask = async (
    db: LibSQLDatabase,
    taskIds: number | number[],
    updates: Partial<{
        status: typeof tasks.$inferSelect['status'];
        assignedTo: number | null;
        metadata: any;
        priority: number;
    }>
) => {
    try {
        const updateData: any = {};

        if (updates.status !== undefined) updateData.status = updates.status;
        if (updates.assignedTo !== undefined) updateData.assignedTo = updates.assignedTo;
        if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata);
        if (updates.priority !== undefined) updateData.priority = updates.priority;

        // Handle single taskId
        if (typeof taskIds === 'number') {
            const result = await db
                .update(tasks)
                .set(updateData)
                .where(eq(tasks.id, taskIds))
                .returning()
                .get();

            return { data: result, success: true };
        }

        // Handle array of taskIds
        const results = [];
        for (const taskId of taskIds) {
            const result = await db
                .update(tasks)
                .set(updateData)
                .where(eq(tasks.id, taskId))
                .returning()
                .get();

            if (result) {
                results.push(result);
            }
        }

        return { data: results, success: true };
    } catch (error: any) {
        console.error('Error updating task(s):', error);
        return { error: error.message || 'Failed to update task(s)', success: false };
    }
};

// Assign task to user
export const assignTask = async (db: LibSQLDatabase, taskId: number, userId: number) => {
    try {
        const result = await db
            .update(tasks)
            .set({
                assignedTo: userId,
                status: 'annotating'
            })
            .where(eq(tasks.id, taskId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error assigning task:', error);
        return { error: error.message || 'Failed to assign task', success: false };
    }
};

// Unassign task (return to pool)
export const unassignTask = async (db: LibSQLDatabase, taskId: number) => {
    try {
        const result = await db
            .update(tasks)
            .set({
                assignedTo: null,
                status: 'unassigned'
            })
            .where(eq(tasks.id, taskId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error unassigning task:', error);
        return { error: error.message || 'Failed to unassign task', success: false };
    }
};

// Complete task
export const completeTask = async (db: LibSQLDatabase, taskId: number) => {
    try {
        const result = await db
            .update(tasks)
            .set({ status: 'completed' })
            .where(eq(tasks.id, taskId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error completing task:', error);
        return { error: error.message || 'Failed to complete task', success: false };
    }
};

// Delete task
export const deleteTask = async (db: LibSQLDatabase, taskId: number) => {
    try {
        const result = await db
            .delete(tasks)
            .where(eq(tasks.id, taskId))
            .returning()
            .get();

        return { data: result, success: true };
    } catch (error: any) {
        console.error('Error deleting task:', error);
        return { error: error.message || 'Failed to delete task', success: false };
    }
};

// Get task statistics for a project
export const getTaskStats = async (db: LibSQLDatabase, projectId: number) => {
    try {
        const allTasks = await db
            .select({ status: tasks.status })
            .from(tasks)
            .where(eq(tasks.projectId, projectId));

        const stats = {
            total: allTasks.length,
            unassigned: allTasks.filter(t => t.status === 'unassigned').length,
            annotating: allTasks.filter(t => t.status === 'annotating').length,
            completed: allTasks.filter(t => t.status === 'completed').length,
        };

        return { data: stats, success: true };
    } catch (error: any) {
        console.error('Error getting task stats:', error);
        return { error: error.message || 'Failed to get task statistics', success: false };
    }
};

//export dataset
export const exportDataset = async (
    db: LibSQLDatabase,
    projectId: number,
    format: string = 'json',
    splitConfig?: SplitConfig
) => {
    try {
        // 1. Get project info and label config
        const project = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .get();

        if (!project) {
            return { success: false, error: 'Project not found' };
        }

        // 2. Get all completed tasks with their annotations
        const tasksWithAnnotations = await db
            .select({
                taskId: tasks.id,
                taskDataUrl: tasks.dataUrl,
                taskDataType: tasks.dataType,
                taskMetadata: tasks.metadata,
                annotationId: annotations.id,
                annotationData: annotations.annotationData,
                isGroundTruth: annotations.isGroundTruth,
                reviewStatus: annotations.reviewStatus,
                userId: annotations.userId,
                userEmail: users.email
            })
            .from(tasks)
            .leftJoin(annotations, eq(tasks.id, annotations.taskId))
            .leftJoin(users, eq(annotations.userId, users.id))
            .where(eq(tasks.projectId, projectId))
            .orderBy(desc(tasks.id));

        if (!tasksWithAnnotations || tasksWithAnnotations.length === 0) {
            return { success: false, error: 'No tasks found for this project' };
        }

        // 3. Group annotations by task
        const tasksMap = new Map();
        tasksWithAnnotations.forEach(row => {
            if (!tasksMap.has(row.taskId)) {
                tasksMap.set(row.taskId, {
                    id: row.taskId,
                    dataUrl: row.taskDataUrl,
                    dataType: row.taskDataType,
                    metadata: row.taskMetadata ? JSON.parse(row.taskMetadata) : null,
                    annotations: []
                });
            }
            
            // Add annotation if it exists
            if (row.annotationId) {
                tasksMap.get(row.taskId).annotations.push({
                    id: row.annotationId,
                    data: typeof row.annotationData === 'string' 
                        ? JSON.parse(row.annotationData) 
                        : row.annotationData,
                    isGroundTruth: row.isGroundTruth,
                    reviewStatus: row.reviewStatus,
                    userId: row.userId,
                    userEmail: row.userEmail
                });
            }
        });

        const allTasks = Array.from(tasksMap.values());
        
        // 4. Filter only tasks with annotations for YOLO/COCO export
        const annotatedTasks = allTasks.filter(task => task.annotations.length > 0);

        if (format === 'yolo' || format === 'coco') {
            if (annotatedTasks.length === 0) {
                return { success: false, error: 'No annotated tasks found for export' };
            }
        }

        // 5. Apply split configuration if provided
        let dataToExport: any;
        const tasksToUse = (format === 'yolo' || format === 'coco') ? annotatedTasks : allTasks;

        if (splitConfig) {
            const { train, test, validation } = splitConfig;
            const shuffled = [...tasksToUse].sort(() => Math.random() - 0.5);

            const total = shuffled.length;
            const trainCount = Math.floor(total * (train / 100));
            const testCount = Math.floor(total * (test / 100));
            const validationCount = total - trainCount - testCount;

            dataToExport = {
                projectId,
                projectName: project.name,
                total,
                format,
                labelConfig: project.labelConfig,
                split: {
                    train: shuffled.slice(0, trainCount),
                    test: shuffled.slice(trainCount, trainCount + testCount),
                    validation: shuffled.slice(trainCount + testCount)
                }
            };
        } else {
            dataToExport = {
                projectId,
                projectName: project.name,
                tasks: tasksToUse,
                total: tasksToUse.length,
                format,
                labelConfig: project.labelConfig
            };
        }

        // 6. Format-specific export logic
        switch (format) {
            case 'json':
                const buffer = Buffer.from(JSON.stringify(dataToExport, null, 2), 'utf-8');
                return { success: true, data: buffer };

            case 'yolo':
                return await exportYOLOFormat(dataToExport, project);

            case 'coco':
                return await exportCOCOFormat(dataToExport, project);

            case 'zip':
                const zip = new JSZip();
                zip.file('dataset.json', JSON.stringify(dataToExport, null, 2));
                const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
                return { success: true, data: zipBuffer };

            default:
                return { success: false, error: 'Unsupported export format' };
        }
    } catch (err: any) {
        console.error('Export failed in service:', err);
        return { success: false, error: err.message || 'Unknown error' };
    }
};

// Helper function to export YOLO format
/**
 * Turn one saved shape into a closed polygon in ORIGINAL image pixels.
 *
 * The product's primary output is a SAM 2 polygon, so a polygon is what the
 * export has to carry. The version this replaced only recognised `bounding_box`,
 * `bbox` and `rectangle`, which is why every label file it wrote came out empty:
 * it never matched the one shape the tool actually produces.
 */
export const shapeToPolygon = (shape: any): { x: number; y: number }[] | null => {
    if (!shape) return null;

    if ((shape.type === 'polygon' || shape.type === 'freehand') && Array.isArray(shape.points)) {
        const pts = shape.points.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
        return pts.length >= 3 ? pts : null;
    }

    if (shape.type === 'rectangle' || shape.type === 'bbox' || shape.type === 'bounding_box') {
        const origin = shape.startPoint ?? { x: shape.x, y: shape.y };
        const w = Number(shape.width), h = Number(shape.height);
        if (!Number.isFinite(origin?.x) || !Number.isFinite(origin?.y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
        // Normalise a negative drag so the corners always run clockwise.
        const x0 = Math.min(origin.x, origin.x + w), x1 = Math.max(origin.x, origin.x + w);
        const y0 = Math.min(origin.y, origin.y + h), y1 = Math.max(origin.y, origin.y + h);
        return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }

    if (shape.type === 'circle') {
        const c = shape.center ?? shape.startPoint;
        const r = Number(shape.radius);
        if (!Number.isFinite(c?.x) || !Number.isFinite(c?.y) || !Number.isFinite(r) || r <= 0) return null;
        // Sixteen sides is under a pixel of error at the sizes annotators draw.
        return Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        });
    }

    // A point or a line encloses no region, so it has no place in a segmentation
    // dataset. Dropping it silently is correct; inventing a box around it is not.
    return null;
};

/**
 * YOLO segmentation export.
 *
 * Segmentation, not detection: the product's shapes are masks, and a box is
 * derivable from a mask while a mask is not derivable from a box. Ultralytics
 * reads `<class> x1 y1 x2 y2 ...` with coordinates normalised to 0..1.
 *
 * The images are the real bytes. What this replaced wrote an 85-byte text file
 * named `<name>.jpg.placeholder` containing the words "Original file: ...", so
 * the archive was correctly shaped and completely unusable.
 */
const exportYOLOFormat = async (data: any, project: any) => {
    try {
        const zip = new JSZip();
        const classes: string[] = project.labelConfig?.classes || [];

        zip.file('classes.txt', classes.join('\n'));
        zip.file('data.yaml', [
            'train: images/train',
            'val: images/val',
            'test: images/test',
            '',
            `nc: ${classes.length}`,
            `names: [${classes.map((c: string) => `'${c}'`).join(', ')}]`
        ].join('\n'));

        // With no split asked for, everything is training data rather than nothing.
        const splits: Record<string, any[]> = data?.split
            ? { train: data.split.train ?? [], val: data.split.validation ?? [], test: data.split.test ?? [] }
            : { train: data?.tasks ?? [] };

        let written = 0, skippedNoFile = 0, skippedNoShape = 0;

        for (const [splitName, splitTasks] of Object.entries(splits)) {
            for (const task of splitTasks) {
                const filename = path.basename(task.dataUrl || '');
                if (!filename) continue;

                const absolute = resolveInsideRoot('./bucket/projects', String(data.projectId ?? project.id), filename);
                if (!absolute || !fs.existsSync(absolute)) { skippedNoFile++; continue; }

                let bytes: Buffer, width: number, height: number;
                try {
                    bytes = await fs.promises.readFile(absolute);
                    const size = imageSize(new Uint8Array(bytes));
                    if (!size) { skippedNoFile++; continue; }
                    width = size.width; height = size.height;
                } catch { skippedNoFile++; continue; }

                const lines: string[] = [];
                for (const record of task.annotations ?? []) {
                    for (const shape of record?.data?.annotations ?? []) {
                        const classIndex = classes.indexOf(shape?.className);
                        if (classIndex < 0) continue;               // not in this project's vocabulary
                        const polygon = shapeToPolygon(shape);
                        if (!polygon) { skippedNoShape++; continue; }

                        const coords = polygon.flatMap(p => [
                            Math.min(1, Math.max(0, p.x / width)),
                            Math.min(1, Math.max(0, p.y / height))
                        ]);
                        lines.push(`${classIndex} ${coords.map(v => v.toFixed(6)).join(' ')}`);
                    }
                }

                const stem = path.parse(filename).name;
                zip.file(`labels/${splitName}/${stem}.txt`, lines.join('\n'));
                zip.file(`images/${splitName}/${filename}`, bytes);
                written += lines.length;
            }
        }

        const content = await zip.generateAsync({ type: 'nodebuffer' });
        console.log(`YOLO export: ${written} shape(s) written; skipped ${skippedNoFile} unreadable file(s), ${skippedNoShape} region-less shape(s)`);
        return { success: true, data: content };
    } catch (error) {
        console.error('YOLO export failed:', error);
        return { success: false, error: 'Failed to build the YOLO export' };
    }
};

// Helper function to export COCO format
/**
 * COCO export.
 *
 * Same repair as the YOLO exporter: the version this replaced recognised only
 * rectangle-shaped annotations and read fields that the saved records do not
 * have, so it emitted a valid COCO envelope with `annotations: []` in it — a
 * file that loads cleanly and teaches a model nothing. It also shipped no
 * images at all, only the JSON.
 *
 * Polygons carry through as COCO segmentation, with the bounding box and area
 * derived from them, which is what a COCO consumer expects to find.
 */
const exportCOCOFormat = async (data: any, project: any) => {
    try {
        const zip = new JSZip();
        const classes: string[] = project.labelConfig?.classes || [];
        const categories = classes.map((name: string, index: number) => ({
            id: index + 1, name, supercategory: 'none'
        }));

        const splits: Record<string, any[]> = data?.split
            ? { train: data.split.train ?? [], val: data.split.validation ?? [], test: data.split.test ?? [] }
            : { train: data?.tasks ?? [] };

        let imageId = 1, annotationId = 1, shapesWritten = 0;

        for (const [splitName, splitTasks] of Object.entries(splits)) {
            const images: any[] = [];
            const cocoAnnotations: any[] = [];

            for (const task of splitTasks) {
                const filename = path.basename(task.dataUrl || '');
                if (!filename) continue;

                const absolute = resolveInsideRoot('./bucket/projects', String(data.projectId ?? project.id), filename);
                if (!absolute || !fs.existsSync(absolute)) continue;

                let bytes: Buffer, width: number, height: number;
                try {
                    bytes = await fs.promises.readFile(absolute);
                    const size = imageSize(new Uint8Array(bytes));
                    if (!size) continue;
                    width = size.width; height = size.height;
                } catch { continue; }

                const thisImageId = imageId++;
                images.push({ id: thisImageId, file_name: filename, width, height });
                zip.file(`images/${splitName}/${filename}`, bytes);

                for (const record of task.annotations ?? []) {
                    for (const shape of record?.data?.annotations ?? []) {
                        const classIndex = classes.indexOf(shape?.className);
                        if (classIndex < 0) continue;
                        const polygon = shapeToPolygon(shape);
                        if (!polygon) continue;

                        const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
                        const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
                        const x1 = Math.min(width, Math.max(...xs)), y1 = Math.min(height, Math.max(...ys));
                        if (x1 <= x0 || y1 <= y0) continue;

                        // The shoelace formula gives the polygon's true area; the
                        // bounding box's area would overstate every concave mask.
                        let twiceArea = 0;
                        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                            twiceArea += (polygon[j]!.x + polygon[i]!.x) * (polygon[j]!.y - polygon[i]!.y);
                        }

                        cocoAnnotations.push({
                            id: annotationId++,
                            image_id: thisImageId,
                            category_id: classIndex + 1,
                            segmentation: [polygon.flatMap(p => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))])],
                            bbox: [x0, y0, x1 - x0, y1 - y0].map(v => Number(v.toFixed(2))),
                            area: Number((Math.abs(twiceArea) / 2).toFixed(2)),
                            iscrowd: 0
                        });
                        shapesWritten++;
                    }
                }
            }

            zip.file(`annotations/instances_${splitName}.json`, JSON.stringify({
                info: { description: project.name, version: '1.0' },
                licenses: [],
                images,
                annotations: cocoAnnotations,
                categories
            }, null, 2));
        }

        const content = await zip.generateAsync({ type: 'nodebuffer' });
        console.log(`COCO export: ${shapesWritten} shape(s) written across ${imageId - 1} image(s)`);
        return { success: true, data: content };
    } catch (error) {
        console.error('COCO export failed:', error);
        return { success: false, error: 'Failed to build the COCO export' };
    }
};