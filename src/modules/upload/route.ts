import { Hono } from 'hono';
import type { Variables } from '../../types';
import { saveFile, createTask } from './service';
import fs from 'fs';
import { jwt } from 'hono/jwt';
import path from 'path';
import unzipper from 'unzipper';

const app = new Hono<{ Variables: Variables }>();

// Get image upload from the server
app.get('/public/:uuid', (c) => {
    try {
        const uuid = c.req.param('uuid');
        if (!uuid) throw new Error('UUID is required');
        const filePath = `./bucket/public/${uuid}.png`;
        if (!filePath) throw new Error('Profile picture not found');
        const fileExists = fs.existsSync(filePath);
        if (!fileExists) throw new Error('Profile picture not found');

        const fileBuffer = fs.readFileSync(filePath);
        if (!fileBuffer) throw new Error('Failed to read profile picture file');

        return c.body(fileBuffer, 200, {
            'Content-Type': 'image/jpeg', // Adjust based on your file type
        });
    } catch (error) {
        console.error('Error in get profile picture route:', error);
        return c.json(
            { error: 'Failed to retrieve profile picture', details: error.message },
            500
        );
    }
});



// Get project files (now supports both UUID and original filename lookup)
app.get('/taskData/:projectId/:fileName', (c) => {
    try {
        const projectId = c.req.param('projectId');
        const fileName = c.req.param('fileName');

        if (!projectId || !fileName) throw new Error('Project ID and file name are required');
        
        const filePath = `./bucket/projects/${projectId}/${fileName}`;
        
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found');
        }

        const fileBuffer = fs.readFileSync(filePath);
        const fileExt = path.extname(fileName).toLowerCase();
        
        let contentType = 'application/octet-stream';
        if (['.jpg', '.jpeg'].includes(fileExt)) {
            contentType = 'image/jpeg';
        } else if (fileExt === '.png') {
            contentType = 'image/png';
        } else if (fileExt === '.gif') {
            contentType = 'image/gif';
        } else if (fileExt === '.webp') {
            contentType = 'image/webp';
        } else if (fileExt === '.bmp') {
            contentType = 'image/bmp';
        }

        return c.body(fileBuffer, 200, {
            'Content-Type': contentType,
        });
    } catch (error) {
        console.error('Error in get project file route:', error);
        return c.json(
            { error: 'Failed to retrieve project file', details: error.message },
            500
        );
    }
});



app.use(
    '*',
    jwt({
        secret: 'honoiscool',
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
            url: `http://localhost:8787/api/bucket/public/${uuid}`, 
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
                                                const imageUrl = `${imageName}`;
                                                
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
                        const imageUrl = `http://localhost:8787/api/bucket/taskData/${projectId}/${imageName}`;
                        
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


export default app;
