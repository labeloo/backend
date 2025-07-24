import { Hono } from 'hono';
import type { Variables } from '../types';
import { jwt } from 'hono/jwt';
import type { payloadType } from './auth/types';

import users from './users/route';
import auth from './auth/route';
import organizations from './organizations/route';
import projects from './projects/route';
import annotations from './annotations/route';
import organizationRoles from './organizationRoles/route';
import organizationRelations from './organizationRelations/route';
import projectRoles from './projectRoles/route';
import projectRelations from './projectRelations/route';
import tasks from './tasks/route';
import bucket from './upload/route';

const app = new Hono<{ Variables: Variables }>();

app.route('/auth', auth);

app.route('/bucket', bucket);

app.use(
    '*',
    jwt({
        secret: 'honoiscool',
    })
);

app.get('/', (c) => {
    console.log('Hello from Hono!');
    const payload = c.var.jwtPayload as payloadType;
    return c.json(payload); // eg: { "sub": "1234567890", "name": "John Doe", "iat": 1516239022 }
});

app.route('/users', users);

app.route('/organizations', organizations);

app.route('/projects', projects);

app.route('/annotations', annotations);

app.route('/organizationRoles', organizationRoles);

app.route('/organizationRelations', organizationRelations);

app.route('/projectRoles', projectRoles);

app.route('/projectRelations', projectRelations);

app.route('/tasks', tasks);

export default app;
