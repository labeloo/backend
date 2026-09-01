import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Variables } from '../../types';
import {
    organizationRelations,
    modelAssets,
    trainingJobs,
} from '../../db/schema';
import { getEntitlements, assertFeature, assertWithinQuota, EntitlementError } from '../../entitlements';
import { resolveActiveBackend, backendAuthHeaders } from '../../backends';
import { recordUsage } from '../../usage';
import { buildYoloSnapshot, type TaskFilter } from '../../dataset';
import catalog from '../../config/weightCatalog.json';

const app = new Hono<{ Variables: Variables }>();

/**
 * Train an organization's own model from the work it has already annotated.
 *
 * The API orchestrates; the trainer service does the GPU work. Every call to
 * the trainer goes through the same resolve-and-meter path the broker uses, so
 * training is counted like any other compute. Weights - both the base ones an
 * org downloads and the ones a run produces - are kept in Storage, which is disk
 * on a self-hosted box and R2 in the cloud, so nothing here touches a disk.
 */

// Same ownership rule as backendRelations: the orgId header names the org, the
// membership check authorizes it.
app.use('*', async (c, next) => {
    const organizationId = Number(c.req.header('orgId'));
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        return c.json({ error: 'Organization ID is required' }, 400);
    }
    const membership = await c.var.db
        .select({ id: organizationRelations.id })
        .from(organizationRelations)
        .where(
            and(
                eq(organizationRelations.userId, c.var.jwtPayload.userId),
                eq(organizationRelations.organizationId, organizationId)
            )
        )
        .get();
    if (!membership) return c.json({ error: 'Forbidden' }, 403);
    c.set('verifiedOrgId', organizationId);

    // Training is a feature the plan may or may not include; check once, here.
    try {
        assertFeature(await getEntitlements(c.var.db, organizationId), 'training');
    } catch (error) {
        if (error instanceof EntitlementError) {
            return c.json({ error: error.message, code: error.code }, error.status);
        }
        throw error;
    }
    return next();
});

const storageKeyForBase = (orgId: number, catalogId: string) =>
    `models/${orgId}/base/${catalogId}.pt`;
const storageKeyForTrained = (orgId: number, jobId: number) =>
    `models/${orgId}/trained/job_${jobId}.pt`;
const storageKeyForDataset = (orgId: number, stamp: number) =>
    `datasets/${orgId}/${stamp}.zip`;

/** The catalogue of base weights an org may download. Nothing is preinstalled. */
app.get('/catalog', (c) => c.json({ data: catalog }));

/** Pull a base weight from its public source and keep it as this org's asset. */
app.post('/weights/:catalogId/download', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const catalogId = c.req.param('catalogId');
    const entry = (catalog as any[]).find((w) => w.id === catalogId);
    if (!entry) return c.json({ error: 'Unknown weight', code: 'unknown-weight' }, 404);

    const existing = await c.var.db
        .select()
        .from(modelAssets)
        .where(
            and(
                eq(modelAssets.organizationId, orgId),
                eq(modelAssets.storageKey, storageKeyForBase(orgId, catalogId))
            )
        )
        .get();
    if (existing) return c.json({ data: existing, alreadyPresent: true });

    let bytes: Uint8Array;
    try {
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error: any) {
        return c.json(
            { error: `Could not fetch the weight: ${error?.message || error}`, code: 'weight-fetch-failed' },
            502
        );
    }

    const key = storageKeyForBase(orgId, catalogId);
    await c.var.storage.put(key, bytes, 'application/octet-stream');
    const [row] = await c.var.db
        .insert(modelAssets)
        .values({
            organizationId: orgId,
            name: entry.name,
            kind: 'base',
            format: 'yolo',
            storageKey: key,
            sizeBytes: bytes.byteLength,
        })
        .returning();
    return c.json({ data: row });
});

/** Every model this org holds: base weights it downloaded, models it trained. */
app.get('/models', async (c) => {
    const rows = await c.var.db
        .select()
        .from(modelAssets)
        .where(eq(modelAssets.organizationId, c.var.verifiedOrgId))
        .orderBy(desc(modelAssets.createdAt))
        .all();
    return c.json({ data: rows });
});

/** Stream a stored weight back to the operator. */
app.get('/models/:id/download', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const id = Number(c.req.param('id'));
    const asset = await c.var.db
        .select()
        .from(modelAssets)
        .where(and(eq(modelAssets.id, id), eq(modelAssets.organizationId, orgId)))
        .get();
    if (!asset) return c.json({ error: 'Not found' }, 404);

    const bytes = await c.var.storage.get(asset.storageKey);
    if (!bytes) return c.json({ error: 'Weight file missing from storage' }, 404);
    return new Response(bytes as unknown as BodyInit, {
        headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${asset.name.replace(/[^\w.-]/g, '_')}.pt"`,
        },
    });
});

/** List this org's training jobs. */
app.get('/jobs', async (c) => {
    const rows = await c.var.db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.organizationId, c.var.verifiedOrgId))
        .orderBy(desc(trainingJobs.createdAt))
        .all();
    return c.json({ data: rows });
});

/** Start a run: snapshot the data, hand it and a base weight to the trainer. */
app.post('/jobs', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const body = await c.req.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    const baseAssetId = Number(body.baseAssetId);
    const filter: TaskFilter = body.taskFilter === 'approved' ? 'approved' : 'completed';
    const epochs = Math.min(1000, Math.max(1, Number(body.epochs) || 50));
    const imgsz = Math.min(1536, Math.max(64, Number(body.imgsz) || 640));

    if (!Number.isInteger(projectId) || !Number.isInteger(baseAssetId)) {
        return c.json({ error: 'projectId and baseAssetId are required' }, 400);
    }

    const base = await c.var.db
        .select()
        .from(modelAssets)
        .where(and(eq(modelAssets.id, baseAssetId), eq(modelAssets.organizationId, orgId)))
        .get();
    if (!base) return c.json({ error: 'Base weight not found' }, 404);

    const trainer = await resolveActiveBackend(c.var.db, orgId, 'trainer');
    if (!trainer) {
        return c.json(
            { error: 'This organization has no active trainer connection.', code: 'trainer-not-configured' },
            404
        );
    }

    // Concurrent-run ceiling. Community is unlimited; the cloud plan caps how
    // many runs an org may have in flight at once.
    try {
        const running = await c.var.db
            .select({ id: trainingJobs.id })
            .from(trainingJobs)
            .where(and(eq(trainingJobs.organizationId, orgId), inArray(trainingJobs.status, ['running', 'paused', 'queued'])))
            .all();
        assertWithinQuota(await getEntitlements(c.var.db, orgId), 'training.concurrentJobs', running.length);
    } catch (error) {
        if (error instanceof EntitlementError) {
            return c.json({ error: error.message, code: error.code }, error.status);
        }
        throw error;
    }

    // Assemble the dataset from completed work. Reports a clear reason (no
    // completed tasks, nothing in the class list) rather than an empty archive.
    let snapshot;
    try {
        snapshot = await buildYoloSnapshot(c.var.db, c.var.storage, projectId, filter);
    } catch (error: any) {
        return c.json({ error: error?.message || 'Could not build a dataset', code: 'dataset-empty' }, 400);
    }

    const datasetKey = storageKeyForDataset(orgId, Date.now());
    await c.var.storage.put(datasetKey, snapshot.zip, 'application/zip');

    const weightBytes = await c.var.storage.get(base.storageKey);
    if (!weightBytes) return c.json({ error: 'Base weight file missing from storage' }, 404);

    // Hand the weight, the data and the hyperparameters to the trainer.
    const form = new FormData();
    form.append('weight', new Blob([weightBytes as BlobPart]), 'base.pt');
    form.append('dataset', new Blob([snapshot.zip as BlobPart]), 'dataset.zip');
    form.append('epochs', String(epochs));
    form.append('imgsz', String(imgsz));

    const started = Date.now();
    let trainerSessionId: string;
    try {
        const response = await fetch(`${trainer.baseUrl}/train`, {
            method: 'POST',
            headers: backendAuthHeaders(trainer),
            body: form,
        });
        if (!response.ok) throw new Error(await response.text());
        const result = (await response.json()) as any;
        trainerSessionId = result.session_id;
    } catch (error: any) {
        await recordUsage(c.var.db, {
            organizationId: orgId,
            backendId: 'trainer',
            kind: 'train-start-failed',
            bytesIn: snapshot.zip.byteLength + weightBytes.byteLength,
            durationMs: Date.now() - started,
        });
        return c.json(
            { error: `The trainer did not accept the job: ${error?.message || error}`, code: 'trainer-unreachable' },
            502
        );
    }

    await recordUsage(c.var.db, {
        organizationId: orgId,
        backendId: 'trainer',
        kind: 'train-start',
        bytesIn: snapshot.zip.byteLength + weightBytes.byteLength,
        durationMs: Date.now() - started,
    });

    const [job] = await c.var.db
        .insert(trainingJobs)
        .values({
            organizationId: orgId,
            projectId,
            baseAssetId,
            status: 'running',
            trainerSessionId,
            datasetKey,
            epochs,
            imgsz,
            progress: 0,
        })
        .returning();

    return c.json({ data: { ...job, dataset: { images: snapshot.imageCount, labels: snapshot.labelCount } } });
});

/** Load a job and refresh its progress from the trainer. */
const loadJob = async (c: any, id: number) =>
    c.var.db
        .select()
        .from(trainingJobs)
        .where(and(eq(trainingJobs.id, id), eq(trainingJobs.organizationId, c.var.verifiedOrgId)))
        .get();

app.get('/jobs/:id', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const job = await loadJob(c, Number(c.req.param('id')));
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (!job.trainerSessionId || ['succeeded', 'failed', 'canceled'].includes(job.status)) {
        return c.json({ data: job });
    }

    const trainer = await resolveActiveBackend(c.var.db, orgId, 'trainer');
    if (!trainer) return c.json({ data: job });

    try {
        const response = await fetch(`${trainer.baseUrl}/jobs/${job.trainerSessionId}`, {
            headers: backendAuthHeaders(trainer),
        });
        if (response.ok) {
            const live = (await response.json()) as any;
            const status =
                live.status === 'succeeded' ? 'succeeded'
                : live.status === 'failed' ? 'failed'
                : live.status === 'paused' ? 'paused'
                : 'running';
            const [updated] = await c.var.db
                .update(trainingJobs)
                .set({
                    status,
                    progress: Math.max(0, Math.min(100, Number(live.progress) || job.progress)),
                    metrics: live.metrics ? JSON.stringify(live.metrics) : job.metrics,
                    error: live.error || null,
                    updatedAt: Math.floor(Date.now() / 1000),
                })
                .where(eq(trainingJobs.id, job.id))
                .returning();
            return c.json({ data: updated });
        }
    } catch {
        // The trainer is momentarily unreachable; return what we last knew
        // rather than failing the poll.
    }
    return c.json({ data: job });
});

const proxyJobAction = (action: 'pause' | 'resume' | 'cancel', nextStatus: string) =>
    async (c: any) => {
        const orgId = c.var.verifiedOrgId;
        const job = await loadJob(c, Number(c.req.param('id')));
        if (!job || !job.trainerSessionId) return c.json({ error: 'Not found' }, 404);
        const trainer = await resolveActiveBackend(c.var.db, orgId, 'trainer');
        if (!trainer) return c.json({ error: 'Trainer not configured' }, 404);
        try {
            const response = await fetch(`${trainer.baseUrl}/jobs/${job.trainerSessionId}/${action}`, {
                method: 'POST',
                headers: backendAuthHeaders(trainer),
            });
            if (!response.ok) throw new Error(await response.text());
        } catch (error: any) {
            return c.json({ error: `Trainer refused ${action}: ${error?.message || error}` }, 502);
        }
        const [updated] = await c.var.db
            .update(trainingJobs)
            .set({ status: nextStatus as any, updatedAt: Math.floor(Date.now() / 1000) })
            .where(eq(trainingJobs.id, job.id))
            .returning();
        return c.json({ data: updated });
    };

app.post('/jobs/:id/pause', proxyJobAction('pause', 'paused'));
app.post('/jobs/:id/resume', proxyJobAction('resume', 'running'));
app.post('/jobs/:id/cancel', proxyJobAction('cancel', 'canceled'));

/** Copy a finished run's weight into Storage as a reusable, downloadable asset. */
app.post('/jobs/:id/register', async (c) => {
    const orgId = c.var.verifiedOrgId;
    const job = await loadJob(c, Number(c.req.param('id')));
    if (!job || !job.trainerSessionId) return c.json({ error: 'Not found' }, 404);
    if (job.outputAssetId) {
        const existing = await c.var.db
            .select()
            .from(modelAssets)
            .where(eq(modelAssets.id, job.outputAssetId))
            .get();
        return c.json({ data: existing, alreadyRegistered: true });
    }

    const trainer = await resolveActiveBackend(c.var.db, orgId, 'trainer');
    if (!trainer) return c.json({ error: 'Trainer not configured' }, 404);

    let bytes: Uint8Array;
    try {
        const response = await fetch(`${trainer.baseUrl}/jobs/${job.trainerSessionId}/weights`, {
            headers: backendAuthHeaders(trainer),
        });
        if (!response.ok) throw new Error(await response.text());
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error: any) {
        return c.json({ error: `Could not fetch the trained weight: ${error?.message || error}` }, 502);
    }

    const key = storageKeyForTrained(orgId, job.id);
    await c.var.storage.put(key, bytes, 'application/octet-stream');
    const [asset] = await c.var.db
        .insert(modelAssets)
        .values({
            organizationId: orgId,
            name: `Trained · job ${job.id}`,
            kind: 'trained',
            format: 'yolo',
            storageKey: key,
            sizeBytes: bytes.byteLength,
            sourceJobId: job.id,
        })
        .returning();
    await c.var.db
        .update(trainingJobs)
        .set({ outputAssetId: asset.id, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(trainingJobs.id, job.id));
    return c.json({ data: asset });
});

export default app;
