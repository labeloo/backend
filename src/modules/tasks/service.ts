import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { eq, and, desc, isNull, not, gt } from 'drizzle-orm';
import { tasks, projects, users, annotations } from '../../db/schema';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';

type SplitConfig = {
    train: number;
    test: number;
    validation: number;
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

// Get tasks assigned to a specific user
export const getTasksByUser = async (db: LibSQLDatabase, userId: number, projectId?: number) => {
    try {
        const whereCondition = projectId
            ? and(eq(tasks.assignedTo, userId), eq(tasks.projectId, projectId))
            : eq(tasks.assignedTo, userId);

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

        return { data: result, success: true };
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
const exportYOLOFormat = async (data: any, project: any) => {
    try {
        const zip = new JSZip();
        const classes = project.labelConfig?.classes || [];
        
        // Create classes.txt file
        zip.file('classes.txt', classes.join('\n'));
        
        // Create data.yaml file
        const dataYaml = `
train: images/train
val: images/val
test: images/test

nc: ${classes.length}
names: [${classes.map((c: string) => `'${c}'`).join(', ')}]
        `.trim();
        zip.file('data.yaml', dataYaml);

        const processTasksForYOLO = (tasks: any[], splitName: string) => {
            const imagesFolder = zip.folder(`images/${splitName}`);
            const labelsFolder = zip.folder(`labels/${splitName}`);

            tasks.forEach(task => {
                // Debug: Log annotation data structure
                if (task.annotations.length > 0) {
                    console.log('Sample annotation data for task', task.id, ':', JSON.stringify(task.annotations[0].data, null, 2));
                    console.log('Total annotations for task', task.id, ':', task.annotations.length);
                }
                
                // Extract filename from dataUrl
                const filename = path.basename(task.dataUrl);
                const nameWithoutExt = path.parse(filename).name;

                // Process annotations for YOLO format
                const yoloAnnotations: string[] = [];
                
                task.annotations.forEach((annotation: any) => {
                    if (annotation.data) {
                        // Get image dimensions with better fallbacks
                        let imageWidth = annotation.data.imageWidth || annotation.data.width;
                        let imageHeight = annotation.data.imageHeight || annotation.data.height;
                        
                        // Handle different annotation data structures
                        let annotationsToProcess = [];
                        if (annotation.data.annotations) {
                            // Structure: { annotations: [...], imageWidth, imageHeight }
                            annotationsToProcess = annotation.data.annotations;
                        } else if (Array.isArray(annotation.data)) {
                            // Structure: [annotation1, annotation2, ...]
                            annotationsToProcess = annotation.data;
                        } else if (annotation.data.type) {
                            // Structure: single annotation object
                            annotationsToProcess = [annotation.data];
                        }
                        
                        annotationsToProcess.forEach((ann: any) => {
                            if (ann.type === 'bounding_box' || ann.type === 'bbox' || ann.type === 'rectangle') {
                                const classIndex = classes.indexOf(ann.class || ann.label || ann.value);
                                if (classIndex >= 0) {
                                    // Validate coordinates and dimensions
                                    const x = parseFloat(ann.x) || 0;
                                    const y = parseFloat(ann.y) || 0;
                                    const w = parseFloat(ann.width) || 0;
                                    const h = parseFloat(ann.height) || 0;
                                    
                                    // Try to get image dimensions from annotation if not available
                                    if (!imageWidth || !imageHeight) {
                                        imageWidth = ann.imageWidth || ann.canvasWidth || 640;
                                        imageHeight = ann.imageHeight || ann.canvasHeight || 480;
                                    }
                                    
                                    // Ensure valid dimensions
                                    const imgW = parseFloat(imageWidth) || 640;
                                    const imgH = parseFloat(imageHeight) || 480;
                                    
                                    // Convert to YOLO format (normalized coordinates)
                                    const centerX = (x + w / 2) / imgW;
                                    const centerY = (y + h / 2) / imgH;
                                    const normWidth = w / imgW;
                                    const normHeight = h / imgH;
                                    
                                    // Validate the calculated values
                                    if (!isNaN(centerX) && !isNaN(centerY) && !isNaN(normWidth) && !isNaN(normHeight) &&
                                        centerX >= 0 && centerX <= 1 && centerY >= 0 && centerY <= 1 &&
                                        normWidth > 0 && normWidth <= 1 && normHeight > 0 && normHeight <= 1) {
                                        yoloAnnotations.push(`${classIndex} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${normWidth.toFixed(6)} ${normHeight.toFixed(6)}`);
                                    } else {
                                        console.warn(`Invalid YOLO coordinates for task ${task.id}:`, {
                                            x, y, w, h, imgW, imgH, centerX, centerY, normWidth, normHeight
                                        });
                                    }
                                }
                            }
                        });
                    }
                });

                // Add label file even if empty (YOLO requirement)
                labelsFolder?.file(`${nameWithoutExt}.txt`, yoloAnnotations.join('\n'));
                
                // Debug: Log number of annotations processed
                console.log(`Processed task ${task.id}: ${yoloAnnotations.length} YOLO annotations generated`);
                
                // Note: In a real implementation, you'd copy the actual image files
                // For now, we just create a placeholder or reference
                imagesFolder?.file(`${filename}.placeholder`, `Original file: ${task.dataUrl}`);
            });
        };

        if (data.split) {
            processTasksForYOLO(data.split.train, 'train');
            processTasksForYOLO(data.split.test, 'test');
            processTasksForYOLO(data.split.validation, 'val');
        } else {
            processTasksForYOLO(data.tasks, 'train');
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        return { success: true, data: zipBuffer };
    } catch (error: any) {
        return { success: false, error: `YOLO export failed: ${error.message}` };
    }
};

// Helper function to export COCO format
const exportCOCOFormat = async (data: any, project: any) => {
    try {
        const zip = new JSZip();
        const classes = project.labelConfig?.classes || [];
        
        const createCOCODataset = (tasks: any[], splitName: string) => {
            const cocoData = {
                info: {
                    description: `${project.name} - ${splitName} split`,
                    version: "1.0",
                    year: new Date().getFullYear(),
                    contributor: "Labeloo",
                    date_created: new Date().toISOString()
                },
                licenses: [{
                    id: 1,
                    name: "Unknown",
                    url: ""
                }],
                images: [] as any[],
                annotations: [] as any[],
                categories: classes.map((className: string, index: number) => ({
                    id: index + 1,
                    name: className,
                    supercategory: "object"
                }))
            };

            let imageId = 1;
            let annotationId = 1;

            tasks.forEach((task: any) => {
                // Debug: Log annotation data structure
                if (task.annotations.length > 0) {
                    console.log('COCO - Sample annotation data for task', task.id, ':', JSON.stringify(task.annotations[0].data, null, 2));
                }
                
                const filename = path.basename(task.dataUrl);
                
                // Add image info
                const imageInfo = {
                    id: imageId,
                    width: 0, // Would need to read from image metadata
                    height: 0, // Would need to read from image metadata
                    file_name: filename,
                    license: 1,
                    flickr_url: "",
                    coco_url: "",
                    date_captured: new Date().toISOString()
                };

                // Try to get image dimensions from annotation data
                if (task.annotations.length > 0 && task.annotations[0].data) {
                    imageInfo.width = task.annotations[0].data.imageWidth || task.annotations[0].data.width || 640;
                    imageInfo.height = task.annotations[0].data.imageHeight || task.annotations[0].data.height || 480;
                }

                cocoData.images.push(imageInfo);

                // Process annotations
                task.annotations.forEach((annotation: any) => {
                    if (annotation.data) {
                        // Get image dimensions with better fallbacks
                        let imgWidth = annotation.data.imageWidth || annotation.data.width || imageInfo.width;
                        let imgHeight = annotation.data.imageHeight || annotation.data.height || imageInfo.height;
                        
                        // Handle different annotation data structures
                        let annotationsToProcess = [];
                        if (annotation.data.annotations) {
                            // Structure: { annotations: [...], imageWidth, imageHeight }
                            annotationsToProcess = annotation.data.annotations;
                        } else if (Array.isArray(annotation.data)) {
                            // Structure: [annotation1, annotation2, ...]
                            annotationsToProcess = annotation.data;
                        } else if (annotation.data.type) {
                            // Structure: single annotation object
                            annotationsToProcess = [annotation.data];
                        }
                        
                        annotationsToProcess.forEach((ann: any) => {
                            if (ann.type === 'bounding_box' || ann.type === 'bbox' || ann.type === 'rectangle') {
                                const categoryId = classes.indexOf(ann.class || ann.label || ann.value) + 1;
                                if (categoryId > 0) {
                                    // Validate coordinates
                                    const x = parseFloat(ann.x) || 0;
                                    const y = parseFloat(ann.y) || 0;
                                    const w = parseFloat(ann.width) || 0;
                                    const h = parseFloat(ann.height) || 0;
                                    
                                    // Try to get image dimensions from annotation if not available
                                    if (!imgWidth || !imgHeight) {
                                        imgWidth = ann.imageWidth || ann.canvasWidth || 640;
                                        imgHeight = ann.imageHeight || ann.canvasHeight || 480;
                                    }
                                    
                                    // Validate the coordinates and dimensions
                                    if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                                        const cocoAnnotation = {
                                            id: annotationId++,
                                            image_id: imageId,
                                            category_id: categoryId,
                                            segmentation: [],
                                            area: w * h,
                                            bbox: [x, y, w, h],
                                            iscrowd: 0
                                        };
                                        cocoData.annotations.push(cocoAnnotation);
                                    } else {
                                        console.warn(`Invalid COCO coordinates for task ${task.id}:`, {
                                            x, y, w, h, imgWidth, imgHeight
                                        });
                                    }
                                }
                            }
                        });
                    }
                });

                imageId++;
            });

            return cocoData;
        };

        if (data.split) {
            // Create separate COCO files for each split
            const trainCoco = createCOCODataset(data.split.train, 'train');
            const testCoco = createCOCODataset(data.split.test, 'test');
            const valCoco = createCOCODataset(data.split.validation, 'val');
            
            zip.file('annotations/instances_train.json', JSON.stringify(trainCoco, null, 2));
            zip.file('annotations/instances_test.json', JSON.stringify(testCoco, null, 2));
            zip.file('annotations/instances_val.json', JSON.stringify(valCoco, null, 2));
        } else {
            // Single COCO file
            const coco = createCOCODataset(data.tasks, 'dataset');
            zip.file('annotations/instances.json', JSON.stringify(coco, null, 2));
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        return { success: true, data: zipBuffer };
    } catch (error: any) {
        return { success: false, error: `COCO export failed: ${error.message}` };
    }
};