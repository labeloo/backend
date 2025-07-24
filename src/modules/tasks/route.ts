import { Hono } from "hono";
import type { Variables } from '../../types';
import {
    getTasksByProject,
    getTasksByUser,
    getUnassignedTasks,
    getTaskById,
    createTask,
    updateTask,
    assignTask,
    unassignTask,
    completeTask,
    deleteTask,
    getTaskStats
} from './service';

const app = new Hono<{ Variables: Variables }>();

// Get all tasks for a specific project
app.get('/project/:projectId', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = Number(c.req.param('projectId'));
        
        if (!projectId) throw new Error('Project ID is required');
        
        const result = await getTasksByProject(db, projectId, userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get tasks by project route:', error);
        return c.json({ error: 'Failed to retrieve project tasks', details: error.message }, 500);
    }
});

// Get tasks assigned to current user (optionally filtered by project)
app.get('/my-tasks', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const projectId = c.req.query('projectId');
        
        const result = await getTasksByUser(db, userId, projectId ? Number(projectId) : undefined);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get user tasks route:', error);
        return c.json({ error: 'Failed to retrieve user tasks', details: error.message }, 500);
    }
});

// Get task by ID
app.get('/:taskId', async (c) => {
    try {
        const db = c.var.db;
        const taskId = Number(c.req.param('taskId'));
        
        if (!taskId) throw new Error('Task ID is required');
        
        const result = await getTaskById(db, taskId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get task by ID route:', error);
        return c.json({ error: 'Failed to retrieve task', details: error.message }, 500);
    }
});

// Create a new task manually
app.post('/create', async (c) => {
    try {
        const db = c.var.db;
        const { projectId, dataUrl, dataType, metadata, priority } = await c.req.json();
        
        if (!projectId || !dataUrl || !dataType) {
            throw new Error('Project ID, data URL, and data type are required');
        }
        
        const result = await createTask(db, projectId, dataUrl, dataType, metadata, priority);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data }, 201);
    } catch (error) {
        console.error('Error in create task route:', error);
        return c.json({ error: 'Failed to create task', details: error.message }, 500);
    }
});

// Update task
app.put('/update', async (c) => {
    try {
        const db = c.var.db;
        const { taskId, ...updates } = await c.req.json();
        
        if (!taskId) throw new Error('Task ID is required in request body');
        
        // Validate taskId (can be number or array of numbers)
        const isValidTaskId = typeof taskId === 'number' || 
            (Array.isArray(taskId) && taskId.every(id => typeof id === 'number'));
        
        if (!isValidTaskId) {
            throw new Error('Task ID must be a number or array of numbers');
        }
        
        const result = await updateTask(db, taskId, updates);

        if (!result.success) throw new Error(result.error);

        return c.json({ 
            data: result.data,
            message: Array.isArray(taskId) 
                ? `Updated ${Array.isArray(result.data) ? result.data.length : 0} tasks` 
                : 'Task updated successfully'
        });
    } catch (error) {
        console.error('Error in update task route:', error);
        return c.json({ error: 'Failed to update task', details: error.message }, 500);
    }
});

// Assign task to user
app.post('/assign/:taskId', async (c) => {
    try {
        const db = c.var.db;
        const taskId = Number(c.req.param('taskId'));
        const { userId } = await c.req.json();
        
        if (!taskId) throw new Error('Task ID is required');
        if (!userId) throw new Error('User ID is required');
        
        const result = await assignTask(db, taskId, userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in assign task route:', error);
        return c.json({ error: 'Failed to assign task', details: error.message }, 500);
    }
});

// Unassign task (return to pool)
app.post('/:taskId/unassign', async (c) => {
    try {
        const db = c.var.db;
        const taskId = Number(c.req.param('taskId'));
        
        if (!taskId) throw new Error('Task ID is required');
        
        const result = await unassignTask(db, taskId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in unassign task route:', error);
        return c.json({ error: 'Failed to unassign task', details: error.message }, 500);
    }
});

// Complete task
app.post('/complete/:taskId', async (c) => {
    try {
        const db = c.var.db;
        const taskId = Number(c.req.param('taskId'));
        
        if (!taskId) throw new Error('Task ID is required');
        
        const result = await completeTask(db, taskId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in complete task route:', error);
        return c.json({ error: 'Failed to complete task', details: error.message }, 500);
    }
});

// Delete task
app.delete('/:taskId', async (c) => {
    try {
        const db = c.var.db;
        const taskId = Number(c.req.param('taskId'));
        
        if (!taskId) throw new Error('Task ID is required');
        
        const result = await deleteTask(db, taskId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete task route:', error);
        return c.json({ error: 'Failed to delete task', details: error.message }, 500);
    }
});

// Get task statistics for a project
app.get('/stats/:projectId', async (c) => {
    try {
        const db = c.var.db;
        const projectId = Number(c.req.param('projectId'));
        
        if (!projectId) throw new Error('Project ID is required');
        
        const result = await getTaskStats(db, projectId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in get task stats route:', error);
        return c.json({ error: 'Failed to retrieve task statistics', details: error.message }, 500);
    }
});

export default app;
