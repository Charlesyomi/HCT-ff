# syntax=docker/dockerfile:1
#
# Production image for the Next.js web app.
#
# Build context is the REPOSITORY ROOT, not apps/web: this is an npm workspaces
# monorepo, so `package-lock.json` lives at the root and `npm ci` must run from there.
# See docker-compose.yml (`web.build.context`).

# --- deps -----------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /repo

# Copy only the manifests first so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# `npm ci` honours the committed lockfile; using it instead of `npm install` is what
# makes the image reproducible. --workspace keeps it to the web app's dependency tree.
RUN npm ci --workspace apps/web --include-workspace-root

# --- build ----------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web

# The catalog pages fetch the API during static generation. The API is not running during
# the build, and `getCatalog()` degrades to null, so this succeeds offline; the pages then
# revalidate within 60s of the first request once the API is up. See docs/RUNBOOK.md.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build --workspace apps/web

# --- runtime --------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# PORT is deliberately not set here. Render injects it at run time and the Next standalone
# server falls back to 3000 when it is absent, which is what the dev compose expects.
ENV HOSTNAME=0.0.0.0

# `output: 'standalone'` emits a self-contained server plus only the node_modules it
# actually loads, so neither the toolchain nor the full dependency tree ships.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

# Run unprivileged. `node` (uid 1000) ships with the base image.
RUN chown -R node:node /app
USER node

# No EXPOSE line: Render assigns the listening port through $PORT at run time.

# Fails the deploy if the app never comes up, instead of shipping a container that
# restarts in a loop. Shell form so $PORT expands.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
