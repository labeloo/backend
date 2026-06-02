# Labeloo backend (Hono + Drizzle + SQLite)
FROM node:22-bookworm-slim

WORKDIR /app

# Build toolchain for native deps (better-sqlite3, sharp) in case prebuilt
# binaries are unavailable for the target platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm install

# App source.
COPY . .

EXPOSE 8787

# JWT_SECRET / DATABASE_URL are provided by docker-compose at runtime.
CMD ["npm", "run", "dev"]
