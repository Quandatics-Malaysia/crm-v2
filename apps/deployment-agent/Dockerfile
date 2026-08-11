# syntax=docker/dockerfile:1

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
RUN npm install -g pnpm@11.6.0
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/deployment-agent/package.json ./apps/deployment-agent/package.json
COPY packages/control-protocol/package.json ./packages/control-protocol/package.json
RUN pnpm install --frozen-lockfile --filter @crm/deployment-agent...
COPY apps/deployment-agent/src ./apps/deployment-agent/src
COPY apps/deployment-agent/tsconfig.json ./apps/deployment-agent/tsconfig.json
COPY packages/control-protocol/src ./packages/control-protocol/src
COPY packages/control-protocol/tsconfig.json packages/control-protocol/tsconfig.build.json ./packages/control-protocol/
RUN pnpm --filter @crm/control-protocol run build \
    && pnpm --filter @crm/deployment-agent run build

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime
ENV NODE_ENV=production
COPY scripts/strip-runtime-package-managers.sh /tmp/strip-runtime-package-managers.sh
RUN /tmp/strip-runtime-package-managers.sh / --container-root \
    && rm /tmp/strip-runtime-package-managers.sh \
    && rm -rf /usr/local/share/doc \
    && addgroup -S -g 10001 crm-agent \
    && adduser -S -D -H -u 10001 -G crm-agent crm-agent \
    && install -d -m 0700 -o crm-agent -g crm-agent /var/lib/crm-agent /app
COPY --from=build --chown=10001:10001 /build/apps/deployment-agent/dist/index.js /app/index.js
COPY --chmod=0555 deploy/client/ops/agent-health.sh /usr/local/bin/agent-health
USER 10001:10001
WORKDIR /app
VOLUME ["/var/lib/crm-agent"]
ENTRYPOINT ["node", "/app/index.js"]
