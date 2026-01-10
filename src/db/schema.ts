import { sql } from 'drizzle-orm';
import { sqliteTable, text, int, index } from 'drizzle-orm/sqlite-core';

// Review-related enums
export const reviewModeEnum = ['auto', 'always-required', 'always-skip'] as const;
export type ReviewMode = typeof reviewModeEnum[number];

export const reviewStatusEnum = ['pending', 'approved', 'rejected', 'changes_requested'] as const;
export type ReviewStatus = typeof reviewStatusEnum[number];

export const taskStatusEnum = ['unassigned', 'annotating', 'completed', 'in_review', 'changes_needed'] as const;
export type TaskStatus = typeof taskStatusEnum[number];
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
    icon: text('icon'),
    color: text('color'),
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
    reviewMode: text('review_mode', {
        enum: reviewModeEnum,
    })
        .notNull()
        .default('auto'),
    allowSelfReview: int('allow_self_review', { mode: 'boolean' })
        .notNull()
        .default(false),
    autoAssignReviewer: int('auto_assign_reviewer', { mode: 'boolean' })
        .notNull()
        .default(true),
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
        enum: taskStatusEnum,
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

// Annotation review status enum - distinct from review decision status
// 'pending' = awaiting review OR awaiting re-submission after changes_requested
// 'approved' = annotation has been approved (final state)
// 'rejected' = annotation has been rejected (final state, requires new annotation)
export const annotationReviewStatusEnum = ['pending', 'approved', 'rejected'] as const;
export type AnnotationReviewStatus = typeof annotationReviewStatusEnum[number];

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
    // Review status of the annotation itself (not the review decision)
    // Maps from review.status: approved→approved, rejected→rejected, changes_requested→pending
    reviewStatus: text('review_status', { enum: annotationReviewStatusEnum })
        .notNull()
        .default('pending'),
    // The ASSIGNED reviewer for this annotation (who should review it)
    // This is set by workflow auto-assignment or manual assignment
    // NOT the same as "who last reviewed" - that info lives in the reviews table
    assignedReviewerId: int('assigned_reviewer_id').references(() => users.id),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const backendRelations = sqliteTable('backend_relations', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    organizationId: int('organization_id')
        .notNull()
        .references(() => organizations.id),
    backendId: text('backend_id').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull(),
    isActive: int('is_active', { mode: 'boolean' }),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const reviews = sqliteTable('reviews', {
    id: text('id').primaryKey(),
    annotationId: int('annotation_id')
        .notNull()
        .references(() => annotations.id, { onDelete: 'cascade' }),
    taskId: int('task_id')
        .notNull()
        .references(() => tasks.id),
    projectId: int('project_id')
        .notNull()
        .references(() => projects.id),
    reviewerId: int('reviewer_id')
        .notNull()
        .references(() => users.id),
    status: text('status', {
        enum: reviewStatusEnum,
    })
        .notNull()
        .default('pending'),
    message: text('message'),
    isAutoApproved: int('is_auto_approved', { mode: 'boolean' })
        .notNull()
        .default(false),
    reviewRound: int('review_round')
        .notNull()
        .default(1),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
}, (table) => [
    index('idx_reviews_annotation').on(table.annotationId),
    index('idx_reviews_task').on(table.taskId),
    index('idx_reviews_project').on(table.projectId),
    index('idx_reviews_reviewer').on(table.reviewerId),
    index('idx_reviews_status').on(table.status),
]);

// Shortcut scopes
export const shortcutScopeEnum = ['canvas', 'global', 'review'] as const;
export type ShortcutScope = typeof shortcutScopeEnum[number];

// User shortcuts - stores only user overrides, not defaults
export const userShortcuts = sqliteTable('user_shortcuts', {
    id: int('id').primaryKey({
        autoIncrement: true,
    }),
    userId: int('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(), // e.g. SAVE_ANNOTATION, TOOL_RECT, TOOL_POLYGON
    key: text('key').notNull(), // e.g. 's', 'ctrl+s', 'r', 'p'
    scope: text('scope', { enum: shortcutScopeEnum })
        .notNull()
        .default('canvas'),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
}, (table) => [
    index('idx_user_shortcuts_user').on(table.userId),
    index('idx_user_shortcuts_action').on(table.userId, table.action),
]);