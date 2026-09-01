import 'dotenv/config';

/**
 * Single source of truth for runtime configuration.
 *
 * Every value is overridable via environment variables so the same build can run
 * on a laptop, in Docker, or on a server without code changes.
 */

/**
 * Secret used to BOTH sign and verify JWTs, and to sign file-access tickets. It
 * must be identical in both places — signing with one secret and verifying with
 * another silently invalidates every session.
 */
export const JWT_SECRET = process.env.JWT_SECRET || 'honoiscool';

/** Algorithm for the JWT middleware. Required by hono >= 4.7. */
export const JWT_ALG = 'HS256';

export const PORT = Number(process.env.PORT || 8787);
export const HOST = process.env.HOST || '0.0.0.0';

/** libsql connection string. Relative paths are resolved against the process CWD. */
export const DATABASE_URL = process.env.DATABASE_URL || 'file:database.db';

/** Browser origins allowed to call this API with credentials. */
export const CORS_ORIGINS = (
    process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://0.0.0.0:3000'
)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Request headers the browser is allowed to send. The list is explicit rather
 * than `*` because the API runs with credentials, where a wildcard is ignored.
 */
export const CORS_HEADERS = [
    'Content-Type',
    'Authorization',
    'orgId',
    'projectId',
    'id',
    'word',
    'export-format',
    'type',
    'fps',
];

/** Ceiling on frames extracted from one upload, so a long video cannot fill the disk. */
export const VIDEO_MAX_FRAMES = Number(process.env.VIDEO_MAX_FRAMES || 2000);

if (JWT_SECRET === 'honoiscool' && process.env.NODE_ENV === 'production') {
    console.warn(
        '[config] WARNING: JWT_SECRET is unset, falling back to the public default secret. ' +
            'Anyone can forge tokens. Set JWT_SECRET before exposing this server.'
    );
}
