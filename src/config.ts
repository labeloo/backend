/**
 * Centralized runtime configuration.
 *
 * Single source of truth for secrets/connection settings so they can never
 * drift between modules (the old code hardcoded the JWT secret in two places
 * and they had silently diverged).
 */

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(
            `Missing required environment variable: ${name}. ` +
                `Set it in your environment or .env file (see .env.example).`
        );
    }
    return value;
}

/** Secret used to BOTH sign (login) and verify (middleware) JWTs. Required. */
export const JWT_SECRET = requireEnv('JWT_SECRET');

/** libSQL/SQLite connection string. Defaults to the local file for dev. */
export const DATABASE_URL = process.env.DATABASE_URL || 'file:database.db';
