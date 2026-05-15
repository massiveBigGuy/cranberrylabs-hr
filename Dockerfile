# syntax=docker/dockerfile:1.7

# ----- Stage 1: build API -----
# Build TypeScript and compile native modules (better-sqlite3 needs python+g++).
FROM node:20-bookworm-slim AS build
# Native module build deps. python3-is-python aliases /usr/bin/python to python3
# so node-gyp finds it under the name it expects.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      python-is-python3 \
      make \
      g++ \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build/api

# Lock-file copied first for better layer caching — only invalidates when
# deps actually change. Dev deps installed too so tsc is available; the prune
# step at the end of this stage strips them before the runtime image copies.
#
# Prefer `npm ci` when a lockfile exists (reproducible). Fall back to
# `npm install` for the bootstrap case where no lockfile has been committed
# yet — the very first build of a brand-new repo. Commit the lockfile after
# the first successful build to lock in reproducible installs from then on.
COPY api/package.json api/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Source after deps. Touching a .ts file shouldn't bust the install layer.
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

# Strip dev deps from this stage's node_modules — the runtime image copies
# from here so this directly affects final image size.
RUN npm prune --omit=dev


# ----- Stage 2: build SPA -----
# Vite + React + Tailwind. Pure JS toolchain, no native modules, so alpine
# is fine here — keeps this stage small and fast. (Contrast with the API
# stage above which needs Debian for better-sqlite3's build deps.)
FROM node:20-alpine AS web-build
WORKDIR /build/web

# Same lockfile-aware install pattern as the API stage for consistency.
# `npm ci` is preferred once web/package-lock.json is committed.
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Source after deps.
COPY web/tsconfig.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/index.html ./
COPY web/src ./src
RUN npm run build
# Output lands at /build/web/dist — copied into the runtime stage below.


# ----- Stage 3: runtime -----
# Slim, no build tools. Runs as a non-root user.
FROM node:20-bookworm-slim AS runtime

# tini is a tiny init for proper signal handling (SIGTERM → graceful shutdown).
# Without it, Node is PID 1 and signal forwarding gets weird.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Match the userid pattern used elsewhere in the homelab if you have one;
# 1000 is a sensible default. Owns /app so writes to data/ and storage/
# (which will be bind-mounted) work without chmod gymnastics.
WORKDIR /app

# Copy compiled API output and pruned node_modules from the API build stage.
COPY --from=build --chown=1000:1000 /build/api/node_modules ./api/node_modules
COPY --from=build --chown=1000:1000 /build/api/dist ./api/dist
COPY --chown=1000:1000 api/package.json ./api/package.json

# Copy the built SPA from the web-build stage. This replaces the empty-dir
# placeholder pattern from previous steps — now there's an actual build.
# The path matches what server.ts resolves to (web/dist relative to where
# api/dist/server.js runs, which is /app).
COPY --from=web-build --chown=1000:1000 /build/web/dist ./web/dist

# Config — same as before. The SPA placeholder mkdir is gone; web/dist is
# populated by the COPY above.
COPY --chown=1000:1000 config ./config

# Mountpoints for the persistent volumes. Pre-creating them with correct
# ownership saves a permissions-debugging session on first run.
RUN mkdir -p /app/data /app/storage && chown -R 1000:1000 /app/data /app/storage

USER 1000

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config/production.yaml

EXPOSE 3000

# Container-level healthcheck — independent of the reverse proxy. Hits the
# unauthenticated /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/api/dist/server.js"]
