# SNBD Console: API + built web app in one image. Postgres is a separate container (see deploy/docker/compose.yml).
# Build for the server's CPU:  docker buildx build --platform linux/amd64 -t snbd-console:latest .
FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.15.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/proto/package.json packages/proto/
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm --filter @snbd/web build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# production dependencies are enough at runtime except tsx, which runs the TypeScript sources
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
COPY scripts/apps scripts/apps
COPY scripts/install.sh scripts/install.sh
COPY manifests manifests
# the signed agent files are mounted at /app/dist/releases (read-only) by compose
USER node
WORKDIR /app/apps/api
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3101)+'/dl/VERSION').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
# apply any new database tables, then start; both read their settings from the environment
CMD ["sh", "-c", "node_modules/.bin/tsx src/migrate.ts && exec node_modules/.bin/tsx src/server.ts"]
