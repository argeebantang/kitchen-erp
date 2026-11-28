# syntax=docker/dockerfile:1
#
# KitchenERP: one image for everything the server runs.
#   app      (default)  next start on port 3000
#   worker              node_modules/.bin/tsx worker/index.ts
#   migrate             node_modules/.bin/prisma migrate deploy
#   seed                node_modules/.bin/tsx prisma/seed.ts
#
# Rebuilt 2026-11-28. The first version (Week 12 deploy, subtask 1) was lost
# before it was committed. This one is taken from the image it built,
# kitchen-erp:local: the final stage below matches that image's layer history
# instruction for instruction, and the earlier stages do what its contents show
# (a full npm ci, a Prisma client for OpenSSL 3, a production build).
#
# Configuration comes only at run time (docker run -e … / env_file). Nothing
# secret is baked in: the build uses placeholders, see the builder stage.

# ─── base: Node 22 on Debian slim, plus what Prisma needs ────────────────────
FROM node:22-bookworm-slim AS base
# Prisma's query engine links against OpenSSL, which the slim image lacks.
# Installed before npm ci so `prisma generate` picks the debian-openssl-3.0.x
# engine, the one this same OS runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ─── builder: dependencies and the production build ──────────────────────────
FROM base AS builder
# Dependencies first, in their own layer: a code change does not reinstall.
# A full install, dev dependencies included: the worker and the seed run under
# tsx, and the build needs TypeScript.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
RUN node_modules/.bin/prisma generate

COPY . .
# lib/config.ts throws at import time on a missing variable, and the build
# imports it. These placeholders only satisfy that check: every page that
# touches the database is rendered on demand, so no query runs during the
# build (the same reason .github/workflows/ci.yml can build without one).
# (Admin → Email starts its queries before the layout's session check, so the
# build logs a few "Can't reach database server" prisma:error lines while Next
# tries to prerender it. Harmless: the route is still rendered on demand — the
# build's route table lists every database page as ƒ.)
# NEXT_PUBLIC_APP_URL is read on the server (config.appUrl) and handed to the
# QR scanner as a prop, never inlined into browser code, so the real URL can
# come at run time too.
# .next/cache is the compiler's cache (about 300 MB): it only speeds up the next
# build on this machine, so it never reaches the image.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    JWT_SECRET=build-only-not-a-secret \
    NEXT_PUBLIC_APP_URL=http://localhost:3000 \
    npm run build \
  && rm -rf .next/cache

# ─── runner: what the server runs ────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY . .
# next start writes its cache under .next, so the node user must own it; the
# rest stays root-owned and read-only to the process.
COPY --from=builder --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
