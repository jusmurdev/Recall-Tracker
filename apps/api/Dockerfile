# Builds the API + worker from the monorepo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --ignore-scripts --workspace @recall/shared --workspace @recall/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @recall/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @recall/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist
# Fixtures are read at runtime when INGEST_USE_FIXTURES=1.
COPY --from=build /app/apps/api/src/ingest/fixtures apps/api/dist/ingest/fixtures
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
