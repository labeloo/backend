// In here we will insert initialization data to the database

import { drizzle } from 'drizzle-orm/libsql/node';
import bcrypt from 'bcryptjs';
import {
    users,
    projectType,
    organizationRoles,
    projectRoles,
} from './src/db/schema';
import fs from 'node:fs';

import { config } from 'dotenv';
config();

(async () => {
    if (!fs.existsSync('database.db')) {
        fs.writeFileSync('database.db', '');
    }

    const db = drizzle('file:database.db');

    const result = await db.run('select 1');
    const health = result.rows[0][0] === 1;
    if (!health) {
        throw new Error('Database is not healthy');
    }

    // add user. email: admin@[process.env.DOMAIN], password: admin
    const email = `${process.env.ADMIN_EMAIL}`;
    const password = `${process.env.ADMIN_PASSWORD}`;
    if (!email || !password) {
        throw new Error('Email and password are required');
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.insert(users).values({
        email,
        password: hashedPassword,
        isActiveUser: true,
    });
    console.log(`User ${email} created with password ${password}`);

    // insert role to the database. name: admin, description: admin, scope: organization, permission_flags: {"admin": true}, organization_id: 0
    await db.insert(organizationRoles).values({
        name: 'admin',
        description: 'admin',
        permissionFlags: {
            admin: true,
            editOrganization: true,
            deleteOrganization: true,
            editMembers: true,
            editRoles: true,
            editProjects: true,
            createProjects: true,
            deleteProjects: true,
        },
    });

    await db.insert(organizationRoles).values({
        name: 'user',
        description: 'Default user role',
        permissionFlags: {
            admin: false,
            editOrganization: false,
            deleteOrganization: false,
            editMembers: false,
            editRoles: false,
            editProjects: true,
            createProjects: true,
            deleteProjects: false,
        },
    });

    //insert into project_types table for seeding
    await db.insert(projectType).values([
        { id: 1, name: 'classification' },
        { id: 2, name: 'object detection' },
    ]);

    await db.insert(projectRoles).values({
        name: 'admin',
        description: 'Admin role for project',
        permissionFlags: {
            editProject: true,
            deleteProject: true,
            editMembers: true,
            editRoles: true,
            uploadFiles: true,
        },
    });

    await db.insert(projectRoles).values({
        name: 'user',
        description: 'User role for project',
        permissionFlags: {
            editProject: false,
            deleteProject: false,
            editMembers: false,
            editRoles: false,
            uploadFiles: false,
        },
    });

    console.log('Default roles created');

    // Default user
    await db.insert(users).values({
        email: 'user@example.com',
        password: await bcrypt.hash('user', 10),
        isActiveUser: true,
    });

    console.log('User created');
})();
