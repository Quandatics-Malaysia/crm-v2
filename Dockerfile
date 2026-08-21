# syntax=docker/dockerfile:1

ARG BUILDPLATFORM

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
# Pin pnpm globally. We use `npm i -g` rather than corepack: corepack is being
# unbundled from newer Node and its registry-signature checks are a recurring
# CI failure. The version must match packageManager in package.json.
RUN npm install -g pnpm@11.6.0
WORKDIR /app

# ---- dependencies (incl. dev, for build + migrate) ----
# Install only the web workspace and its dependency closure. The production
# web and migrator images do not need the control-plane or deployment-agent
# dependency trees. Keep the other workspace manifests available so pnpm can
# validate the frozen lockfile and workspace graph.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/deployment-agent/package.json ./apps/deployment-agent/package.json
COPY apps/control-plane/package.json ./apps/control-plane/package.json
COPY packages/control-protocol/package.json ./packages/control-protocol/package.json
RUN pnpm install --filter web... --frozen-lockfile

# ---- build the standalone Next.js server ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/control-protocol/node_modules ./packages/control-protocol/node_modules
COPY . .
RUN pnpm --filter @crm/control-protocol run build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web run build --turbopack

# ---- compile architecture-neutral migrate/seed assets on the native runner ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS migrator-base
RUN apk add --no-cache libc6-compat \
    && npm install -g pnpm@11.6.0
WORKDIR /app

FROM migrator-base AS migrator-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/deployment-agent/package.json ./apps/deployment-agent/package.json
COPY apps/control-plane/package.json ./apps/control-plane/package.json
COPY packages/control-protocol/package.json ./packages/control-protocol/package.json
RUN pnpm install --filter web... --frozen-lockfile

FROM migrator-base AS migrator-build
COPY --from=migrator-deps /app/node_modules ./node_modules
COPY --from=migrator-deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=migrator-deps /app/packages/control-protocol/node_modules ./packages/control-protocol/node_modules
COPY . .
RUN pnpm --filter @crm/control-protocol run build
RUN pnpm --filter web run build:migrator --turbopack

# ---- source-free privileged migrate/seed job image ----
FROM base AS migrator
ENV NODE_ENV=production
COPY scripts/strip-runtime-package-managers.sh /tmp/strip-runtime-package-managers.sh
RUN /tmp/strip-runtime-package-managers.sh / --container-root \
    && rm /tmp/strip-runtime-package-managers.sh
COPY --from=migrator-build /app/dist/migrator/ ./
CMD ["sh", "-c", "node /app/migrate.mjs && node /app/seed.mjs"]

# ---- minimal production runner ----
# outputFileTracingRoot is the repo root, so the standalone bundle nests the app
# under apps/web/. Entrypoint is apps/web/server.js; public + static are not
# auto-copied into the standalone tree, so copy them into the nested app path.
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY scripts/strip-runtime-package-managers.sh /tmp/strip-runtime-package-managers.sh
RUN /tmp/strip-runtime-package-managers.sh / --container-root \
    && rm /tmp/strip-runtime-package-managers.sh \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
