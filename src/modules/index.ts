import { Hono } from 'hono';
import type { Variables } from '../types';
import { jwt } from 'hono/jwt';
import { JWT_SECRET, JWT_ALG } from '../config';
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
import backendRelations from './backendRelations/route';
import access from './access/route';
import assist from './assist/route';
import training from './training/route';
import billing from './billing/route';
import admin from './admin/route';

const app = new Hono<{ Variables: Variables }>();

app.route('/auth', auth);

app.route('/bucket', bucket);

app.use(
    '*',
    jwt({
        secret: JWT_SECRET,
        alg: JWT_ALG,
    })
);

app.get('/', (c) => {
    console.log('Hello from Hono!');
    const payload = c.var.jwtPayload as payloadType;
    return c.json(payload); // eg: { "sub": "1234567890", "name": "John Doe", "iat": 1516239022 }
});

app.route('/access', access);
app.route('/assist', assist);
app.route('/training', training);
app.route('/billing', billing);
app.route('/admin', admin);
app.route('/users', users);

app.route('/organizations', organizations);

app.route('/projects', projects);

app.route('/annotations', annotations);

app.route('/organizationRoles', organizationRoles);

app.route('/organizationRelations', organizationRelations);

app.route('/projectRoles', projectRoles);

app.route('/projectRelations', projectRelations);

app.route('/tasks', tasks);

app.route('/backendRelations', backendRelations);

export default app;
