/**
 * Build a YOLO training snapshot from an organization's own annotations.
 *
 * The existing export reads image files straight off the disk with `fs`, so it
 * cannot run on a Worker and is broken in the cloud edition. Training must work
 * in both editions, so this builder goes through the `Storage` interface
 * instead - disk on a self-hosted box, R2 in the cloud - and never touches the
 * filesystem directly.
 *
 * The output is a single zip: `images/<task>.jpg`, `labels/<task>.txt` in YOLO
 * segmentation format, plus `data.yaml` and `classes.txt`. That is exactly what
 * ultralytics expects, so the trainer service can unzip it and train with no
 * further shaping.
 */

import JSZip from 'jszip';
import path from 'path';
import { and, eq, inArray } from 'drizzle-orm';

import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import type { Storage } from './storage';
import { projects, tasks, annotations } from './db/schema';
import { shapeToPolygon } from './modules/tasks/service';
import { imageSize } from './imageSize';

export type TaskFilter = 'completed' | 'approved';

export type SnapshotResult = {
    zip: Uint8Array;
    classes: string[];
    imageCount: number;
    labelCount: number;
    skipped: { noImage: number; noSize: number; noShape: number };
};

/** A key under the bucket for a task's image, matching how uploads are stored. */
const imageKeyFor = (projectId: number, dataUrl: string) =>
    `projects/${projectId}/${path.basename(dataUrl || '')}`;

export const buildYoloSnapshot = async (
    db: LibSQLDatabase,
    storage: Storage,
    projectId: number,
    filter: TaskFilter
): Promise<SnapshotResult> => {
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) throw new Error('Project not found');
    const classes: string[] = project.labelConfig?.classes || [];

    // Only completed tasks are training material; annotating/unassigned are not
    // finished work and would teach the model half-drawn shapes.
    const completed = await db
        .select({ id: tasks.id, dataUrl: tasks.dataUrl })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'completed')))
        .all();

    if (completed.length === 0) {
        throw new Error('This project has no completed tasks to train on.');
    }

    const taskIds = completed.map((t) => t.id);
    const annRows = await db
        .select()
        .from(annotations)
        .where(inArray(annotations.taskId, taskIds))
        .all();

    // One task can have several annotation records; keep the ones that count.
    // 'approved' narrows to work a reviewer signed off on.
    const byTask = new Map<number, any[]>();
    for (const row of annRows) {
        if (filter === 'approved' && row.reviewStatus !== 'approved') continue;
        const list = byTask.get(row.taskId) || [];
        list.push(row);
        byTask.set(row.taskId, list);
    }

    const zip = new JSZip();
    zip.file('classes.txt', classes.join('\n'));
    zip.file(
        'data.yaml',
        [
            'path: .',
            'train: images',
            'val: images',
            '',
            `nc: ${classes.length}`,
            `names: [${classes.map((c) => `'${c}'`).join(', ')}]`,
            '',
        ].join('\n')
    );

    let imageCount = 0;
    let labelCount = 0;
    const skipped = { noImage: 0, noSize: 0, noShape: 0 };

    for (const task of completed) {
        const records = byTask.get(task.id);
        if (!records || records.length === 0) continue;

        const bytes = await storage.get(imageKeyFor(projectId, task.dataUrl));
        if (!bytes) {
            skipped.noImage++;
            continue;
        }
        const size = imageSize(bytes);
        if (!size) {
            skipped.noSize++;
            continue;
        }
        const { width, height } = size;

        const lines: string[] = [];
        for (const record of records) {
            const data =
                typeof record.annotationData === 'string'
                    ? JSON.parse(record.annotationData)
                    : record.annotationData;
            for (const shape of data?.annotations ?? []) {
                const classIndex = classes.indexOf(shape?.className);
                if (classIndex < 0) continue;
                const polygon = shapeToPolygon(shape);
                if (!polygon) {
                    skipped.noShape++;
                    continue;
                }
                const coords = polygon.flatMap((p) => [
                    Math.min(1, Math.max(0, p.x / width)),
                    Math.min(1, Math.max(0, p.y / height)),
                ]);
                lines.push(`${classIndex} ${coords.map((v) => v.toFixed(6)).join(' ')}`);
            }
        }

        if (lines.length === 0) continue;

        const base = path.basename(task.dataUrl || `task_${task.id}`);
        const stem = base.replace(/\.[^.]+$/, '') || `task_${task.id}`;
        zip.file(`images/${base}`, bytes);
        zip.file(`labels/${stem}.txt`, lines.join('\n'));
        imageCount++;
        labelCount += lines.length;
    }

    if (imageCount === 0) {
        throw new Error(
            'No trainable examples: completed tasks had no labels in this project\'s class list.'
        );
    }

    const out = await zip.generateAsync({ type: 'uint8array' });
    return { zip: out, classes, imageCount, labelCount, skipped };
};
