# UrbanPulse Backend – Copilot Instructions

## Architecture

Turborepo + pnpm monorepo for a ride-sharing backend. Three workspace packages:

- **`apps/api-gateway`** – Express 5 HTTP server (port 3001). All REST endpoints live here: auth, user, rides.
- **`apps/ride-worker`** – Background worker for ride-related processing (BullMQ). Consumes shared types and Prisma client from `packages/common`.
- **`packages/common`** – Shared Prisma client, Zod validation schemas, and type exports. Consumed via `"common": "workspace:^"`.

Data flows: **Route → validate middleware (Zod) → authenticate middleware (JWT) → service → Prisma/raw SQL → PostgreSQL+PostGIS**.

## Key Conventions

### Module System

ESM-only (`"type": "module"` everywhere). All local imports **must** use `.js` extensions (e.g., `import prisma from '../utils/db.js'`). TypeScript compiles with `"module": "nodenext"`.

### Validation Pattern

Zod schemas in `packages/common/schemas/` wrap `body`, `query`, `params` keys. The `validate()` middleware in `apps/api-gateway/src/middleware/validate.ts` calls `schema.parseAsync({ body, query, params })`. When adding a new schema, follow this structure:

```ts
export const mySchema = z.object({
  body: z.object({
    /* fields */
  }),
});
export type MyInput = z.infer<typeof mySchema>['body'];
```

Export from `packages/common/schemas/index.ts` and import in routes via `import { mySchema } from 'common'`.

### API Response Format

All endpoints return `{ success: boolean, message: string, data?: ... }`. Errors include `errors` array for validation failures. Follow this in every route handler and service return type.

### Auth & Authorization

JWT via `Bearer` token. Middleware chain: `authenticate` (verifies token, sets `req.user: JwtPayload`) → optional `authorize('driver' | 'rider')`. `JwtPayload` contains `{ userId, number, role }`.

### PostGIS / Spatial Data

Prisma schema uses `Unsupported("geometry(Point,4326)")` for location fields. These **cannot** use standard Prisma CRUD – use `prisma.$queryRaw` with `ST_GeomFromText` / `ST_AsText` for spatial operations (see `ride.service.ts`). Coordinates are `[longitude, latitude]`.

### Database

Single Prisma client instance in `apps/api-gateway/src/utils/db.ts` (cached on `globalThis` in dev). Schema lives at `packages/common/prisma/schema.prisma`. Models: `User` ↔ `Driver`/`Rider` (1:1) → `Trip`.

### Logging

Pino logger (`apps/api-gateway/src/logger.ts`). Use `pino-pretty` in dev. Always use structured logging: `logger.info({ userId }, 'message')` not string interpolation.

## Developer Workflow

```bash
# Setup & run (Docker-based, includes PostGIS + Redis)
source activate.sh    # loads aliases: dcu, dcd, dcr, dcl, dc
dcu                   # docker-compose up -d (postgres + redis + api-gateway + ride-worker)
dcl                   # tail logs

# Build & typecheck
pnpm build            # turbo build (common first, then api-gateway and ride-worker)
pnpm typecheck        # turbo typecheck

# DB migrations (run inside container or with DATABASE_URL set)
cd packages/common
npx prisma migrate dev --name <name>
npx prisma generate   # auto-runs on postinstall
```

## Adding a New Feature Checklist

1. **Schema** – If new Zod validation is needed, add to `packages/common/schemas/`, export from `index.ts`
2. **Prisma** – If new model/field, edit `packages/common/prisma/schema.prisma`, run `prisma migrate dev`
3. **Service** – Add business logic in `apps/api-gateway/src/services/` with typed return interface
4. **Route** – Add route file in `apps/api-gateway/src/routes/`, wire middleware chain (`authenticate`, `validate(schema)`)
5. **Register** – Mount the router in `apps/api-gateway/src/routes.ts`
6. **Rebuild common** – After changing `packages/common`, run `pnpm build` so `dist/` is updated for the gateway

## Environment Variables

Passed via `.env` and Docker Compose. Key vars (see `turbo.json` passthrough): `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `APP_PORT`, `JWT_SECRET`, `NODE_ENV`, `LOGGING_TOKEN`, `LOGGING_URL`.

## File Naming

- Route files: `<domain>.routes.ts` (e.g., `ride.routes.ts`)
- Service files: `<domain>.service.ts`
- Schema files: `<domain>.schema.ts`
- All in lowercase, kebab-case for multi-word
