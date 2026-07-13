# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- dependencies (incl. dev, for build + migrate) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build the standalone Next.js server ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- migrate/seed job image (has tsx + drizzle-kit + source) ----
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["sh", "-c", "node_modules/.bin/tsx db/migrate.ts && node_modules/.bin/tsx --conditions=react-server db/seed.ts && if [ \"$SEED_SAMPLE_DATA\" = \"true\" ]; then echo '→ SEED_SAMPLE_DATA=true — layering sample demo data'; node_modules/.bin/tsx --conditions=react-server db/seed-sample.ts; fi"]

# ---- minimal production runner ----
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
