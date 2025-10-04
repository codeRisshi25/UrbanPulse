# Dockerfile

# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# ---- Dependencies & Build ----
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY packages/common/package.json ./packages/common/
COPY packages/common/prisma ./packages/common/prisma
RUN pnpm i
COPY . .
RUN pnpm build

# ---- Runner ----
FROM base AS runner
WORKDIR /app
ARG APP_NAME
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/${APP_NAME}/dist ./dist
COPY --from=build /app/apps/${APP_NAME}/package.json .
EXPOSE 3000
CMD ["pnpm", "start"]
