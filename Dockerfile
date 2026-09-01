# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV CI=true
# Installed globally rather than through corepack: corepack caches the shim under
# the *invoking user's* home (/root/.cache), which becomes unreadable the moment
# the entrypoint drops privileges. /usr/local is readable by everyone.
RUN npm install -g pnpm@11.5.2
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
# drizzle-kit and ts-node live in devDependencies but are needed at runtime to
# migrate and seed, so this is a full install rather than --prod.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json drizzle.config.ts script.ts ./
COPY src ./src
RUN pnpm build

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_URL=file:/app/data/database.db

# ffmpeg powers video frame extraction (POST /api/bucket/uploadDataVideo); curl
# backs the healthcheck. ffmpeg is the bulk of this image - drop it only if you
# do not need video import.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json drizzle.config.ts script.ts ./
COPY src ./src
COPY drizzle ./drizzle
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Both are bind-mounted in compose; creating them keeps a bare `docker run` working.
# The entrypoint drops to the `node` user after fixing volume ownership, so the
# app directory must be writable by it (pnpm writes scratch files there).
RUN mkdir -p /app/data /app/bucket/projects /app/bucket/public \
             /app/bucket/profilePictures/userProfile \
 && chown -R node:node /app

EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
# Runs the compiled output directly; pnpm is not on the runtime path.
CMD ["node", "dist/src/index.js"]
