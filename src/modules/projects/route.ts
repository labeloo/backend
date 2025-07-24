import { Hono } from "hono";
import type { Variables } from '../../types';
import {
    getProjectById,
    getProjects,
    createProject,
    updateProject,
    deleteProject,
} from './service';
import type { projects } from "../../db/schema";

const app = new Hono<{ Variables: Variables }>();

//get all projects with userId for specific organization
app.get('/all', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;
        const organizationId = c.req.header('orgId');
        if (!organizationId) throw new Error('Organization ID is required');
        
        const result = await getProjects(db, userId, Number(organizationId));

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    }catch (error) {
        console.error('Error in get projects route:', error);
        return c.json({ error: 'Failed to retrieve projects', details: error.message }, 500);
    }
})

//get project by id
app.get('/:id',async (c)=>{
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        if (!id) throw new Error('Project ID is required');
        const userId = c.var.jwtPayload.userId;
        const result = await getProjectById(db, userId, Number(id));
        if (!result.success) throw new Error(result.error);
        return c.json({ data: result.data });
    }catch (error) {
        console.error('Error in get project by id route:', error);
        return c.json({ error: 'Failed to retrieve project', details: error.message }, 500);
    }
})

//create project (also insert into project relations with transaction when inserting into projects, for user with admin role : admin roles id is 1)
app.post('/', async (c) => {
    try {
        const db = c.var.db;
        const payload = c.var.jwtPayload;
        const userId = payload.userId;

        // Parse the request body
        const body = await c.req.json<typeof projects.$inferInsert>();


        const projectData: typeof projects.$inferInsert = {
            organizationId: body.organizationId,
            name: body.name,
            description: body.description,
            projectType: body.projectType,
            labelConfig: body.labelConfig,
        };

        const result = await createProject(db, projectData, userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in create project route:', error);
        return c.json({ error: 'Failed to create project', details: error.message }, 500);
    }
})

//update project by id
app.put('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        if (!id) throw new Error('Project ID is required');
        const payload = c.var.jwtPayload;
        const userId = payload.userId;

        // Parse the request body
        const body = await c.req.json<typeof projects.$inferInsert>();

        const projectData: typeof projects.$inferInsert = {
            organizationId: body.organizationId,
            name: body.name,
            description: body.description,
            projectType: body.projectType,
            labelConfig: body.labelConfig,
        };

        const result = await updateProject(db,projectData, Number(id),  userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in update project route:', error);
        return c.json({ error: 'Failed to update project', details: error.message }, 500);
    }
})

//delete project by id
app.delete('/:id', async (c) => {
    try {
        const db = c.var.db;
        const id = c.req.param('id');
        if (!id) throw new Error('Project ID is required');
        const payload = c.var.jwtPayload;
        const userId = payload.userId;

        const result = await deleteProject(db, Number(id), userId);

        if (!result.success) throw new Error(result.error);

        return c.json({ data: result.data });
    } catch (error) {
        console.error('Error in delete project route:', error);
        return c.json({ error: 'Failed to delete project', details: error.message }, 500);
    }
})

export default app;
