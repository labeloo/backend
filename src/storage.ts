import fs from 'fs';
import path from 'path';
import { resolveInsideRoot } from './utils';

/**
 * Where uploaded images and extracted frames live.
 *
 * The product has to run two ways at once: a self-hoster brings up the Docker
 * stack and gets a directory on their own disk, and the hosted version runs on
 * Workers where there is no disk at all. Both are first-class, so neither is
 * allowed to leak into the modules that read and write files - they ask this
 * interface for a key and get bytes back.
 *
 * Keys are the path a file already had under `bucket/`, so nothing about the
 * existing URLs or database rows has to change: `projects/3/frame_0009.jpg`.
 */
export interface Storage {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    /** True where a spawned binary and a writable directory exist - ffmpeg's home. */
    readonly hasLocalDisk: boolean;
}

/** A key is only ever a relative path inside the bucket; `..` is not a key. */
const safeKey = (key: string) => key.replace(/^\/+/, '').replace(/\\/g, '/');

export class DiskStorage implements Storage {
    readonly hasLocalDisk = true;

    constructor(private root = './bucket') {}

    private resolve(key: string) {
        return resolveInsideRoot(this.root, ...safeKey(key).split('/'));
    }

    async get(key: string): Promise<Uint8Array | null> {
        const file = this.resolve(key);
        if (!file || !fs.existsSync(file)) return null;
        return new Uint8Array(await fs.promises.readFile(file));
    }

    async put(key: string, bytes: Uint8Array): Promise<void> {
        const file = this.resolve(key);
        if (!file) throw new Error(`Refusing to write outside the bucket: ${key}`);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, bytes);
    }

    async exists(key: string): Promise<boolean> {
        const file = this.resolve(key);
        return Boolean(file) && fs.existsSync(file!);
    }
}

export class R2Storage implements Storage {
    // No spawned processes and no writable directory on a Worker, so the ffmpeg
    // path has to be refused rather than fail halfway through an upload.
    readonly hasLocalDisk = false;

    constructor(private bucket: R2Bucket) {}

    async get(key: string): Promise<Uint8Array | null> {
        const object = await this.bucket.get(safeKey(key));
        if (!object) return null;
        return new Uint8Array(await object.arrayBuffer());
    }

    async put(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
        await this.bucket.put(safeKey(key), bytes, {
            httpMetadata: contentType ? { contentType } : undefined,
        });
    }

    async exists(key: string): Promise<boolean> {
        return (await this.bucket.head(safeKey(key))) !== null;
    }
}

/** Minimal R2 surface, so the Node build needs no Workers types installed. */
export interface R2Bucket {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    head(key: string): Promise<unknown | null>;
}
