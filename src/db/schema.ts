import { sql } from 'drizzle-orm';
import { sqliteTable, text, int } from 'drizzle-orm/sqlite-core';
import type {
    OrganizationPermissionFlags,
    ProjectPermissionFlags,
} from '../modules/organizationRoles/types';

export const users = sqliteTable('users', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    email: text('email').notNull().unique(),
    password: text('password').notNull(),
    isActiveUser: int('is_active_user', { mode: 'boolean' })
        .notNull()
        .default(true),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const organizations = sqliteTable('organizations', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    ownerId: int('owner_id')
        .notNull()
        .references(() => users.id),
    name: text('name').notNull(),
    logo: text('logo'),
    description: text('description'),
    isActiveOrg: int('is_active_org', { mode: 'boolean' })
        .notNull()
        .default(true),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const organizationRoles = sqliteTable('organization_roles', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    name: text('name').notNull(),
    description: text('description'),
    organizationId: int('organization_id').references(() => organizations.id),
    permissionFlags: text('permission_flags', {
        mode: 'json',
    })
        .notNull()
        .$type<OrganizationPermissionFlags>(),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const projectRoles = sqliteTable('project_roles', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    name: text('name').notNull(),
    description: text('description'),
    organizationId: int('organization_id').references(() => organizations.id),
    permissionFlags: text('permission_flags', {
        mode: 'json',
    })
        .notNull()
        .$type<ProjectPermissionFlags>(),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const organizationRelations = sqliteTable('organization_relations', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    userId: int('user_id')
        .notNull()
        .references(() => users.id),
    organizationId: int('organization_id')
        .notNull()
        .references(() => organizations.id),
    roleId: int('role_id')
        .notNull()
        .references(() => organizationRoles.id), //scope in the roles table should be organization in order to be valid
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const projectType = sqliteTable('project_type', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    name: text('name').notNull(),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const projects = sqliteTable('projects', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    organizationId: int('organization_id')
        .notNull()
        .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    projectType: int('project_type')
        .notNull()
        .references(() => projectType.id),
    labelConfig: text('label_config', {
        mode: "json",
    }).$type<{
        classes: string[];
    }>(),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const projectRelations = sqliteTable('project_relations', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    userId: int('user_id')
        .notNull()
        .references(() => users.id),
    projectId: int('project_id')
        .notNull()
        .references(() => projects.id),
    roleId: int('role_id')
        .notNull()
        .references(() => projectRoles.id),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const tasks = sqliteTable('tasks', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    projectId: int('project_id')
        .notNull()
        .references(() => projects.id),
    dataUrl: text('data_url').notNull(),
    dataType: text('data_type').notNull(), //this will be a json string
    status: text('status', {
        enum: ['unassigned', 'annotating', 'completed']
    })
        .notNull()
        .default('unassigned'),
    assignedTo: int('assigned_to').references(() => users.id), //NULL if the task is in the pool
    metadata: text('metadata'), //this will be a json string
    priority: int('priority').notNull().default(0),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const annotations = sqliteTable('annotations', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    taskId: int('task_id')
        .notNull()
        .references(() => tasks.id), //this will reference a task table
    userId: int('user_id')
        .notNull()
        .references(() => users.id),
    projectId: int('project_id')
        .notNull()
        .references(() => projects.id),
    annotationData: text('annotation_data', {
        mode: 'json',
    }).notNull(),
    isGroundTruth: int('is_ground_truth', {
        mode: 'boolean',
    })
        .notNull()
        .default(false),
    reviewStatus: text('review_status', ['pending', 'approved', 'rejected'])
        .notNull()
        .default('pending'),
    reviewerId: int('reviewer_id').references(() => users.id),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});
