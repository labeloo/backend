import { Hono } from "hono";
import type { Variables } from "../../types";
import {
	getAnnotations,
	getAnnotationById,
	createAnnotation,
	getAnnotationsByTaskId,
	deleteAnnotation,
	// updateAnnotation, these are not implemented yet
} from "./service";
import type { annotations } from "../../db/schema";

const app = new Hono<{ Variables: Variables }>();

//get all annotations with userId
app.get("/all", async (c) => {
	try {
		const db = c.var.db;
		const userId = c.var.jwtPayload.userId;
		const result = await getAnnotations(db, userId);

		if (!result.success) throw new Error(result.error);

		return c.json({ data: result.data });
	} catch (error) {
		console.error("Error in get annotations route:", error);
		return c.json(
			{ error: "Failed to retrieve annotations", details: error.message },
			500,
		);
	}
});

//get annotation by id
app.get("/:id", async (c) => {
	try {
		const db = c.var.db;
		const id = c.req.param("id");
		if (!id) throw new Error("Annotation ID is required");
		const userId = c.var.jwtPayload.userId;

		const result = await getAnnotationById(db, userId, Number(id));

		if (!result.success) throw new Error(result.error);

		return c.json({ data: result.data });
	} catch (error) {
		console.error("Error in get annotation by id route:", error);
		return c.json(
			{ error: "Failed to retrieve annotation", details: error.message },
			500,
		);
	}
});

//get all annotations for a specific task
app.get("/task/:taskId", async (c) => {
	try {
		const db = c.var.db;
		const taskId = c.req.param("taskId");

		if (!taskId) throw new Error("Task ID is required");

		const result = await getAnnotationsByTaskId(db, Number(taskId));

		if (!result.success) throw new Error(result.error);

		return c.json({ data: result.data });
	} catch (error) {
		console.error("Error in get annotations by task route:", error);
		return c.json(
			{ error: "Failed to retrieve task annotations", details: error.message },
			500,
		);
	}
});

//create annotation
app.post("/", async (c) => {
	try {
		const db = c.var.db;
		const payload = c.var.jwtPayload;
		const userId = payload.userId;

		// Parse the request body
		const body = await c.req.json<typeof annotations.$inferInsert>();

		// Set the user ID to the current user
		const annotationData: typeof annotations.$inferInsert = {
			...body,
			userId: userId,
		};

		const result = await createAnnotation(db, annotationData);

		if (!result.success) throw new Error(result.error);

		return c.json({ data: result.data });
	} catch (error) {
		console.error("Error in create annotation route:", error);
		return c.json(
			{ error: "Failed to create annotation", details: error.message },
			500,
		);
	}
});

//update annotation

//delete annotation
app.delete("/:id", async (c) => {
	try {
		const db = c.var.db;
		const id = c.req.param("id");
		const userId = c.var.jwtPayload.userId;
		
		if (!id) throw new Error("Annotation ID is required");
		
		const result = await deleteAnnotation(db, userId, Number(id));

		if (!result.success) throw new Error(result.error);

		return c.json({ 
			data: result.data,
			message: "Annotation deleted successfully"
		});
	} catch (error) {
		console.error("Error in delete annotation route:", error);
		return c.json(
			{ error: "Failed to delete annotation", details: error.message },
			500,
		);
	}
});

export default app;