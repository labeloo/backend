import fs from 'fs';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { tasks } from '../../db/schema';

export const saveFile = async (file: ArrayBuffer, path: string): Promise<boolean> => {
    // Create directory if it doesn't exist
    const dir = path.split('/').slice(0, -1).join('/');
    await fs.promises.mkdir(dir, { recursive: true });

    return new Promise((resolve, reject) => {
        fs.writeFile(path, Buffer.from(file), (err) => {
            if (err) {
                console.error('Error saving file:', err);
                return reject(err);
            }
            resolve(true);
        });
    });
};

// Insert a task into the database
export const createTask = async (
    db: LibSQLDatabase,
    projectId: number,
    dataUrl: string,
    dataType: string,
    metadata?: any
) => {
    try {
        const result = await db
            .insert(tasks)
            .values({
                projectId,
                dataUrl,
                dataType: JSON.stringify(dataType),
                metadata: metadata ? JSON.stringify(metadata) : null,
                status: 'unassigned',
                priority: 0,
            })
            .returning()
            .get();
        
        return { data: result, success: true };
    } catch (error) {
        console.error('Error creating task:', error);
        return { error: error.message || 'Failed to create task', success: false };
    }
};
