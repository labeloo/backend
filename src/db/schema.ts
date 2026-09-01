import { sql } from 'drizzle-orm';
import { sqliteTable, text, int, index } from 'drizzle-orm/sqlite-core';
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
    // The operator of the whole deployment, distinct from an organization admin.
    // Gates the platform admin panel. The seeded admin is one; in the cloud it is
    // granted by hand. Everyone else is false, which is the safe default.
    isPlatformAdmin: int('is_platform_admin', { mode: 'boolean' })
        .notNull()
        .default(false),
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

/**
 * Append-only ledger of metered work, written by the assist broker.
 *
 * The server never saw a compute call while the browser talked to the service
 * directly, so cloud usage could not be counted or limited. Every call now goes
 * through the broker, which records one row here. This is the single source the
 * SaaS quota checks and the admin panel's usage views both read; nothing else
 * needs to know how work is measured.
 *
 * `units` is 1 per call today and becomes GPU-seconds once the trainer reports
 * them - the column is here now so that change needs no migration.
 */
export const usageEvents = sqliteTable(
    'usage_events',
    {
        id: int('id').primaryKey({ autoIncrement: true }),
        organizationId: int('organization_id')
            .notNull()
            .references(() => organizations.id),
        backendId: text('backend_id').notNull(),
        kind: text('kind').notNull(),
        units: int('units').notNull().default(1),
        bytesIn: int('bytes_in').notNull().default(0),
        bytesOut: int('bytes_out').notNull().default(0),
        durationMs: int('duration_ms').notNull().default(0),
        createdAt: int({ mode: 'number' })
            .notNull()
            .default(sql`(unixepoch())`),
    },
    (t) => [
        // Every quota and admin query is "this org, this window", so the range
        // scan wants the org first and the time second.
        index('usage_events_org_time').on(t.organizationId, t.createdAt),
    ]
);

/**
 * A stored model weight an organization can train from or keep.
 *
 * Base weights are pulled from a public catalogue on demand - nothing ships
 * preinstalled, so an org downloads only the architecture it wants. Trained
 * weights are the output of a training job, kept here so they can be downloaded
 * again or reused as the base for the next run.
 */
export const modelAssets = sqliteTable('model_assets', {
    id: int('id').primaryKey({ autoIncrement: true }),
    organizationId: int('organization_id')
        .notNull()
        .references(() => organizations.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['base', 'trained'] }).notNull(),
    format: text('format').notNull().default('yolo'),
    storageKey: text('storage_key').notNull(),
    sizeBytes: int('size_bytes').notNull().default(0),
    sourceJobId: int('source_job_id'),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});

/**
 * One training run. The heavy work happens in the trainer service; this row is
 * the API's durable record of it - what it was trained on, where it is, and how
 * far it got - so a job survives a page reload and an operator can come back to
 * it. Progress and metrics are refreshed from the trainer when the job is read.
 */
export const trainingJobs = sqliteTable(
    'training_jobs',
    {
        id: int('id').primaryKey({ autoIncrement: true }),
        organizationId: int('organization_id')
            .notNull()
            .references(() => organizations.id),
        projectId: int('project_id').references(() => projects.id),
        baseAssetId: int('base_asset_id')
            .notNull()
            .references(() => modelAssets.id),
        status: text('status', {
            enum: ['queued', 'running', 'paused', 'succeeded', 'failed', 'canceled'],
        }).notNull(),
        trainerSessionId: text('trainer_session_id'),
        datasetKey: text('dataset_key'),
        epochs: int('epochs').notNull().default(50),
        imgsz: int('imgsz').notNull().default(640),
        progress: int('progress').notNull().default(0),
        metrics: text('metrics'),
        outputAssetId: int('output_asset_id'),
        error: text('error'),
        createdAt: int({ mode: 'number' })
            .notNull()
            .default(sql`(unixepoch())`),
        updatedAt: int({ mode: 'number' })
            .notNull()
            .default(sql`(unixepoch())`),
    },
    (t) => [index('training_jobs_org').on(t.organizationId, t.createdAt)]
);

/**
 * An organization's plan in the cloud edition.
 *
 * No row means the free plan, so a new org needs no setup. The community edition
 * never writes here - its entitlements are unlimited without consulting a plan.
 * The external ids link to whatever billing provider is configured; they are
 * null under the no-op provider, where an operator sets the plan by hand.
 */
export const orgSubscriptions = sqliteTable('org_subscriptions', {
    id: int('id').primaryKey({ autoIncrement: true }),
    organizationId: int('organization_id')
        .notNull()
        .unique()
        .references(() => organizations.id),
    plan: text('plan').notNull().default('free'),
    status: text('status', { enum: ['active', 'past_due', 'canceled'] })
        .notNull()
        .default('active'),
    billingProvider: text('billing_provider').notNull().default('none'),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    currentPeriodStart: int('current_period_start'),
    currentPeriodEnd: int('current_period_end'),
    createdAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
    updatedAt: int({ mode: 'number' })
        .notNull()
        .default(sql`(unixepoch())`),
});
