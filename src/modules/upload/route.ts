import { Hono } from 'hono';
import type { Variables } from '../../types';
import { saveFile, createTask } from './service';
import { resolveInsideRoot } from '../../utils';
import {
    extractFrames,
    FfmpegMissingError,
    VIDEO_EXTENSIONS,
} from './video';
import fs from 'fs';
import { jwt } from 'hono/jwt';
import { JWT_SECRET, JWT_ALG } from '../../config';
import { verifyTicket, ticketAllowsProject, type TicketPayload } from '../../accessTicket';
import path from 'path';
import unzipper from 'unzipper';

const app = new Hono<{ Variables: Variables }>();

/**
 * These two GET routes are mounted BEFORE the JWT middleware, because a browser
 * sends no Authorization header with an `<img src>` and the app's cookie belongs
 * to the frontend's origin, not the API's. Until this guard existed they were
 * therefore open to the whole internet: every uploaded image and every extracted
 * video frame was readable by anyone who knew a path.
 *
 * The ticket in the query string is the credential an `<img>` can carry.
 */
const readTicket = async (c: any): Promise<TicketPayload | null> =>
    verifyTicket(JWT_SECRET, c.req.query('t'), Math.floor(Date.now() / 1000));

// Get image upload from the server
app.get('/public/:uuid', async (c) => {
    try {
        if (!(await readTicket(c))) return c.json({ error: 'Unauthorized' }, 401);

        const uuid = c.req.param('uuid');
        if (!uuid) throw new Error('UUID is required');

        const bytes = await c.get('storage').get(`public/${uuid}.png`);
        if (!bytes) throw new Error('Profile picture not found');

        return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
            'Content-Type': 'image/png',
        });
    } catch (error) {
        console.error('Error in get profile picture route:', error);
        return c.json({ error: 'Failed to retrieve profile picture' }, 404);
    }
});

// Get project files (now supports both UUID and original filename lookup)
app.get('/taskData/:projectId/:fileName', async (c) => {
    try {
        const projectId = c.req.param('projectId');
        const fileName = c.req.param('fileName');
        if (!projectId || !fileName) throw new Error('Project ID and file name are required');

        // Identity alone is not enough: the ticket also names the projects its
        // holder may read, so one member cannot walk another team's frames.
        const ticket = await readTicket(c);
        if (!ticket || !ticketAllowsProject(ticket, Number(projectId))) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const bytes = await c.get('storage').get(`projects/${projectId}/${fileName}`);
        if (!bytes) throw new Error('File not found');

        const ext = path.extname(fileName).toLowerCase();
        const contentType =
            ext === '.png' ? 'image/png' :
            ext === '.gif' ? 'image/gif' :
            ext === '.webp' ? 'image/webp' :
            ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' :
            'application/octet-stream';

        return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
            'Content-Type': contentType,
            // Frames never change once extracted, so let the browser keep them.
            'Cache-Control': 'public, max-age=31536000, immutable',
        });
    } catch (error) {
        console.error('Error in get project file route:', error);
        return c.json({ error: 'Failed to retrieve file' }, 404);
    }
});

app.use(
    '*',
    jwt({
        secret: JWT_SECRET,
        alg: JWT_ALG,
    })
);

// Upload profile picture to the server
app.post('/uploadPicture', async (c) => {
    try {
        // Handle file upload logic here
        const file = await c.req.arrayBuffer();
        if (!file) throw new Error('Profile picture file is required');      
        
        const uuid = crypto.randomUUID();
        const uploadPath = `./bucket/public/${uuid}.png`;

        // Save the file to the server or cloud storage
        const result = await saveFile(file, uploadPath);

        if (!result) throw new Error('Failed to save profile picture');

        return c.json({
            url: `/api/bucket/public/${uuid}`, 
        });
    } catch (error) {
        console.error('Error in upload profile picture route:', error);
        return c.json(
            {
                error: 'Failed to upload profile picture',
                details: error.message,
            },
            500
        );
    }
});

// Upload project data (zip file or multiple images) to the server
app.post('/uploadData', async (c) => {
    try {
        const db = c.var.db;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');

        const formData = await c.req.formData();
        const files = formData.getAll('files');
        
        if (!files || files.length === 0) {
            throw new Error('At least one file is required');
        }

        // Create project directories
        const projectDir = `./bucket/projects/${projectId}`;
        const rawDir = `${projectDir}/raw`;
        
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }
        if (!fs.existsSync(rawDir)) {
            fs.mkdirSync(rawDir, { recursive: true });
        }

        const uploadedFiles = [];
        const createdTasks = [];
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

        for (const file of files) {
            if (file instanceof File) {
                const fileBuffer = await file.arrayBuffer();
                const originalFileName = file.name || 'unknown';
                const fileExt = path.extname(originalFileName).toLowerCase();
                
                if (fileExt === '.zip') {
                    // Save zip file to raw directory with UUID
                    const uuid = crypto.randomUUID();
                    const zipFileName = `${uuid}.zip`;
                    const zipPath = `${rawDir}/${zipFileName}`;
                    const result = await saveFile(fileBuffer, zipPath);
                    
                    if (result) {
                        try {
                            // Extract zip file and filter for images only
                            const extractedFiles: any[] = [];
                            
                            // Create a readable stream from the buffer
                            const stream = require('stream');
                            const bufferStream = new stream.PassThrough();
                            bufferStream.end(Buffer.from(fileBuffer));
                            
                            // Extract zip contents
                            await new Promise((resolve, reject) => {
                                bufferStream
                                    .pipe(unzipper.Parse())
                                    .on('entry', async (entry: any) => {
                                        const entryFileName = entry.path;
                                        const type = entry.type;
                                        const entryFileExt = path.extname(entryFileName).toLowerCase();
                                        
                                        // Only process image files
                                        if (type === 'File' && imageExtensions.includes(entryFileExt)) {
                                            const imageUuid = crypto.randomUUID();
                                            const imageName = `${imageUuid}${entryFileExt}`;
                                            const imagePath = path.join(projectDir, imageName);
                                            const writeStream = fs.createWriteStream(imagePath);
                                            
                                            entry.pipe(writeStream);
                                            
                                            writeStream.on('close', async () => {
                                                const imageUrl = `/api/bucket/taskData/${projectId}/${imageName}`;
                                                
                                                // Create task for the extracted image
                                                const taskResult = await createTask(
                                                    db,
                                                    parseInt(projectId),
                                                    imageUrl,
                                                    'image',
                                                    {
                                                        originalFileName: path.basename(entryFileName),
                                                        extractedFrom: originalFileName,
                                                        mimeType: `image/${entryFileExt.substring(1)}`,
                                                        uuid: imageUuid
                                                    }
                                                );
                                                  if (taskResult.success && taskResult.data) {
                                                    createdTasks.push(taskResult.data);
                                                }
                                                
                                                extractedFiles.push({
                                                    type: 'extracted_image',
                                                    uuid: imageUuid,
                                                    fileName: imageName,
                                                    originalFileName: path.basename(entryFileName),
                                                    path: imagePath,
                                                    url: imageUrl,
                                                    taskId: (taskResult.success && taskResult.data) ? taskResult.data.id : null
                                                });
                                            });
                                        } else {
                                            // Skip non-image files
                                            entry.autodrain();
                                        }
                                    })
                                    .on('finish', resolve)
                                    .on('error', reject);
                            });
                            
                            uploadedFiles.push({
                                type: 'zip',
                                uuid: uuid,
                                fileName: zipFileName,
                                originalFileName: originalFileName,
                                path: zipPath,
                                message: `Zip file extracted successfully. ${extractedFiles.length} image(s) found and ${createdTasks.filter(t => t).length} tasks created.`,
                                extractedFiles: extractedFiles
                            });
                            
                        } catch (extractError: any) {
                            console.error('Error extracting zip:', extractError);
                            uploadedFiles.push({
                                type: 'zip',
                                uuid: uuid,
                                fileName: zipFileName,
                                originalFileName: originalFileName,
                                path: zipPath,
                                message: 'Zip file saved but extraction failed. Please check the zip file format.',
                                error: extractError.message
                            });
                        }
                    }
                } else if (imageExtensions.includes(fileExt)) {
                    // Save image files directly to project directory with UUID
                    const imageUuid = crypto.randomUUID();
                    const imageName = `${imageUuid}${fileExt}`;
                    const imagePath = `${projectDir}/${imageName}`;
                    const result = await saveFile(fileBuffer, imagePath);
                    
                    if (result) {
                        const imageUrl = `/api/bucket/taskData/${projectId}/${imageName}`;
                        
                        // Create task for the direct image upload
                        const taskResult = await createTask(
                            db,
                            parseInt(projectId),
                            imageUrl,
                            'image',
                            {
                                originalFileName: originalFileName,
                                mimeType: `image/${fileExt.substring(1)}`,
                                uuid: imageUuid
                            }
                        );
                          if (taskResult.success && taskResult.data) {
                            createdTasks.push(taskResult.data);
                        }
                        
                        uploadedFiles.push({
                            type: 'image',
                            uuid: imageUuid,
                            fileName: imageName,
                            originalFileName: originalFileName,
                            path: imagePath,
                            url: imageUrl,
                            taskId: (taskResult.success && taskResult.data) ? taskResult.data.id : null
                        });
                    }
                } else {
                    // Skip non-image files
                    uploadedFiles.push({
                        type: 'skipped',
                        fileName: originalFileName,
                        message: 'File skipped - only images and zip files are allowed'
                    });
                }
            }
        }

        return c.json({
            message: 'Upload completed',
            projectId: projectId,
            uploadedFiles: uploadedFiles,
            createdTasks: createdTasks.length,
            projectDir: projectDir
        });
    } catch (error) {
        console.error('Error in upload data route:', error);
        return c.json(
            {
                error: 'Failed to upload data',
                details: error.message,
            },
            500
        );
    }
});


/**
 * Upload videos and turn them into annotation tasks, one per extracted frame.
 *
 * The UI lets the annotator pick a frame rate (1-60 fps) and reports back how
 * many frames were produced, so the response must carry `createdTasks` as a count.
 * Each frame records the second it came from, which is what lets the timeline
 * line frames up against the source video.
 *
 * Headers: `projectId`, `fps`.  Body: multipart with one or more `files`.
 */
app.post('/uploadDataVideo', async (c) => {
    try {
        const db = c.var.db;
        const projectId = c.req.header('projectId');
        if (!projectId) throw new Error('Project ID is required');
        if (!/^\d+$/.test(projectId)) throw new Error('Project ID must be numeric');

        const fps = Number(c.req.header('fps') ?? 5);
        if (!Number.isFinite(fps) || fps <= 0 || fps > 60) {
            return c.json({ error: 'fps must be a number between 1 and 60' }, 400);
        }

        const formData = await c.req.formData();
        const files = formData.getAll('files');
        if (!files || files.length === 0) {
            throw new Error('At least one file is required');
        }

        const projectDir = resolveInsideRoot('./bucket/projects', projectId);
        if (!projectDir) throw new Error('Invalid project ID');
        const rawDir = path.join(projectDir, 'raw');
        fs.mkdirSync(rawDir, { recursive: true });

        const uploadedFiles: any[] = [];
        const createdTasks: any[] = [];

        for (const file of files) {
            if (!(file instanceof File)) continue;

            const originalFileName = file.name || 'unknown';
            const fileExt = path.extname(originalFileName).toLowerCase();

            if (!VIDEO_EXTENSIONS.includes(fileExt)) {
                uploadedFiles.push({
                    type: 'skipped',
                    fileName: originalFileName,
                    message: `File skipped - supported video formats are ${VIDEO_EXTENSIONS.join(', ')}`,
                });
                continue;
            }

            const uuid = crypto.randomUUID();
            const videoPath = path.join(rawDir, `${uuid}${fileExt}`);
            await saveFile(await file.arrayBuffer(), videoPath);

            let frames;
            try {
                frames = await extractFrames(videoPath, projectDir, uuid, fps);
            } catch (extractError: any) {
                if (extractError instanceof FfmpegMissingError) throw extractError;
                console.error('Error extracting frames:', extractError);
                uploadedFiles.push({
                    type: 'video',
                    uuid,
                    fileName: `${uuid}${fileExt}`,
                    originalFileName,
                    path: videoPath,
                    message: 'Video saved but frame extraction failed.',
                    error: extractError.message,
                });
                continue;
            }

            const frameEntries = [];
            for (const frame of frames) {
                const frameUrl = `/api/bucket/taskData/${projectId}/${frame.fileName}`;
                const taskResult = await createTask(db, parseInt(projectId), frameUrl, 'image', {
                    originalFileName,
                    // The annotator sees this in the task card ("From: ..."), so it
                    // must be the name they uploaded, not the stored UUID.
                    extractedFrom: originalFileName,
                    storedFileName: `${uuid}${fileExt}`,
                    mimeType: 'image/jpeg',
                    uuid,
                    frameIndex: frame.frameIndex,
                    timestampSeconds: frame.timestampSeconds,
                    fps,
                });
                if (taskResult.success && taskResult.data) {
                    createdTasks.push(taskResult.data);
                }
                frameEntries.push({
                    fileName: frame.fileName,
                    url: frameUrl,
                    frameIndex: frame.frameIndex,
                    timestampSeconds: frame.timestampSeconds,
                    taskId: taskResult.success && taskResult.data ? taskResult.data.id : null,
                });
            }

            uploadedFiles.push({
                type: 'video',
                uuid,
                fileName: `${uuid}${fileExt}`,
                originalFileName,
                path: videoPath,
                fps,
                frameCount: frames.length,
                message: `${frames.length} frame(s) extracted at ${fps} FPS.`,
                frames: frameEntries,
            });
        }

        return c.json({
            message: 'Video upload completed',
            projectId,
            fps,
            uploadedFiles,
            createdTasks: createdTasks.length,
            projectDir,
        });
    } catch (error) {
        console.error('Error in upload video route:', error);
        const status = error instanceof FfmpegMissingError ? 501 : 500;
        return c.json({ error: 'Failed to upload videos', details: error.message }, status);
    }
});

export default app;
