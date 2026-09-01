import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import type { Variables } from '../../types';
import { projectRelations } from '../../db/schema';
import { JWT_SECRET } from '../../config';
import { issueTicket } from '../../accessTicket';

const app = new Hono<{ Variables: Variables }>();

/**
 * Hand the caller a short-lived ticket their `<img>` tags can carry.
 *
 * This route sits behind the JWT middleware, so identity is already proven here;
 * all it does is convert that identity into a form a browser will actually
 * attach to an image request. See src/accessTicket.ts for why a header or a
 * cookie cannot do the job.
 */
app.get('/ticket', async (c) => {
    try {
        const db = c.var.db;
        const userId = c.var.jwtPayload.userId;

        const rows = await db
            .select({ projectId: projectRelations.projectId })
            .from(projectRelations)
            .where(eq(projectRelations.userId, userId));

        const { ticket, expiresAt } = await issueTicket(
            JWT_SECRET,
            userId,
            rows.map((r) => r.projectId),
            Math.floor(Date.now() / 1000)
        );

        return c.json({ ticket, expiresAt });
    } catch (error) {
        console.error('Error issuing access ticket:', error);
        return c.json({ error: 'Failed to issue access ticket' }, 500);
    }
});

export default app;
