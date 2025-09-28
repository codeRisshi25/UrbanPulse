# Dockerfile

# ---- Stage 1: The Builder ----
FROM node:20-alpine AS builder
WORKDIR /data/app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ /data/app/apps/
COPY packages/ /data/app/packages/

RUN pnpm install

RUN pnpm --filter api-gateway run build


# ---- Stage 2: The Runner ----
FROM node:20-alpine
WORKDIR /data/app
RUN corepack enable

COPY --from=builder /data/app/apps/api-gateway/package.json ./package.json
COPY --from=builder /data/app/pnpm-lock.yaml ./
# Copy the production node_modules for just this service
COPY --from=builder /data/app/apps/api-gateway/node_modules ./node_modules
# Copy the compiled JavaScript output
COPY --from=builder /data/app/apps/api-gateway/dist ./dist

EXPOSE 3000

# The final command to run the production server
CMD ["pnpm", "run", "start:api"]