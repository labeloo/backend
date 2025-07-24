import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { eq, and, desc, isNull, not, gt } from 'drizzle-orm';
import { tasks, projects, users } from '../../db/schema';
import fs from 'fs';

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
