# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
# Pin pnpm globally. We use `npm i -g` rather than corepack: corepack is being
# unbundled from newer Node and its registry-signature checks are a recurring
# CI failure. The version must match packageManager in package.json.
RUN npm install -g pnpm@11.6.0
WORKDIR /app

# ---- dependencies (incl. dev, for build + migrate) ----
# Install the whole pnpm workspace. Copy the root manifests + lockfile and the
# app manifest so the frozen install resolves the `web` workspace package.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- build the standalone Next.js server ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web run build

# ---- migrate/seed job image (has tsx + drizzle-kit + source) ----
# db/ now lives under apps/web, so run tsx from that workspace directory.
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
WORKDIR /app/apps/web
CMD ["sh", "-c", "node_modules/.bin/tsx db/migrate.ts && node_modules/.bin/tsx --conditions=react-server db/seed.ts && if [ \"$SEED_SAMPLE_DATA\" = \"true\" ]; then echo '→ SEED_SAMPLE_DATA=true — layering sample demo data'; node_modules/.bin/tsx --conditions=react-server db/seed-sample.ts; fi"]

# ---- minimal production runner ----
# outputFileTracingRoot is the repo root, so the standalone bundle nests the app
# under apps/web/. Entrypoint is apps/web/server.js; public + static are not
# auto-copied into the standalone tree, so copy them into the nested app path.
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
