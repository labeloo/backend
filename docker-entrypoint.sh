#!/bin/sh
set -e

# Start as root only long enough to make the mounted volumes writable, then drop
# privileges for everything that follows. Named volumes are created root-owned at
# first run, so this cannot be done at build time.
if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/data /app/bucket/projects /app/bucket/public /app/bucket/profilePictures/userProfile
    chown -R node:node /app/data /app/bucket
    exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

# Local binaries rather than `pnpm exec`: pnpm insists on a writable home for its
# own config, which the unprivileged user does not have.
export PATH="/app/node_modules/.bin:$PATH"

# Migrations are idempotent and cheap, so they run on every start: a fresh volume
# is set up automatically and an existing one is brought up to date.
echo "[entrypoint] Applying database migrations to ${DATABASE_URL}"
drizzle-kit migrate

# Seed only when asked, and only once - script.ts is not idempotent.
if [ "${SEED_ON_START}" = "true" ] && [ ! -f /app/data/.seeded ]; then
    # A default password in the advertised one-click path is a published
    # credential: every install that skips the .env would share it, and the
    # value is in the repository for anyone to read.
    if [ -z "${ADMIN_PASSWORD}" ] || [ "${ADMIN_PASSWORD}" = "labeloo" ] || [ "${ADMIN_PASSWORD}" = "changeme" ]; then
        echo "[entrypoint] Refusing to seed: set ADMIN_PASSWORD to something of your own." >&2
        echo "[entrypoint] Copy .env.example to .env and choose a password, then start again." >&2
        exit 1
    fi
    echo "[entrypoint] Seeding initial admin user and project types"
    ts-node script.ts && touch /app/data/.seeded
fi

exec "$@"
