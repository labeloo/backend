import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { VIDEO_MAX_FRAMES } from '../../config';

const execFileAsync = promisify(execFile);

/** Container formats the upload UI advertises. */
export const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];

export type ExtractedFrame = {
    fileName: string;
    /** Position of this frame in the source video, in seconds. */
    timestampSeconds: number;
    frameIndex: number;
};

export class FfmpegMissingError extends Error {
    constructor() {
        super(
            'ffmpeg is not installed. It is required to extract frames from videos. ' +
                'The Docker image ships with it; for a local run install it with ' +
                '`brew install ffmpeg` or `apt install ffmpeg`.'
        );
        this.name = 'FfmpegMissingError';
    }
}

export const isFfmpegAvailable = async (): Promise<boolean> => {
    try {
        await execFileAsync('ffmpeg', ['-version']);
        return true;
    } catch {
        return false;
    }
};

/**
 * Extract frames from `videoPath` at `fps` frames per second.
 *
 * Frames are written next to the project's images so they are served by the same
 * route, and named after the source video so they can be traced back to it.
 *
 * Arguments are passed to ffmpeg as an array, never through a shell: the file
 * names contain user-supplied text.
 */
export const extractFrames = async (
    videoPath: string,
    outputDir: string,
    namePrefix: string,
    fps: number
): Promise<ExtractedFrame[]> => {
    if (!(await isFfmpegAvailable())) {
        throw new FfmpegMissingError();
    }

    await fs.promises.mkdir(outputDir, { recursive: true });
    const pattern = path.join(outputDir, `${namePrefix}_%06d.jpg`);

    await execFileAsync(
        'ffmpeg',
        [
            '-hide_banner',
            '-loglevel', 'error',
            '-nostdin',
            '-i', videoPath,
            '-vf', `fps=${fps}`,
            // -q:v 2 is visually near-lossless JPEG; annotators zoom in on these.
            '-q:v', '2',
            // Hard stop so one long video cannot fill the disk or the task list.
            '-frames:v', String(VIDEO_MAX_FRAMES),
            '-y',
            pattern,
        ],
        // Frame extraction is CPU bound and can take a while on a long video.
        { maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60 * 1000 }
    );

    const produced = (await fs.promises.readdir(outputDir))
        .filter((f) => f.startsWith(`${namePrefix}_`) && f.endsWith('.jpg'))
        .sort();

    return produced.map((fileName, index) => ({
        fileName,
        frameIndex: index,
        // ffmpeg's fps filter emits frames on an even grid, so frame i sits at i/fps.
        timestampSeconds: Number((index / fps).toFixed(3)),
    }));
};
