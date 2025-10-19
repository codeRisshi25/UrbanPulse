# Urban Pulse Backend - Rebuild Checklist

> **Purpose**: Complete inventory of current codebase features to rebuild from scratch in Express

---

## 📋 Project Overview

- **Name**: Urban Pulse Backend
- **Type**: Ride-sharing/transportation platform API
- **Current Framework**: Fastify (migrating to Express)
- **Architecture**: Monorepo (pnpm + Turborepo)
Cannot find name 'console'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'. (ts 2584)
---

## 🏗️ Infrastructure & Tooling

### Monorepo Structure
- [ ] **pnpm workspace** setup (`pnpm-workspace.yaml`)
  - Packages: `apps/*` and `packages/*`
  - Package manager: `pnpm@10.18.0`

- [ ] **Turborepo** configuration (`turbo.json`)
  - Build task with dependency graph (`^build`)
  - Dev task with environment pass-through
  - Cache outputs in `.turbo/` directory

- [ ] **TypeScript** project references
  - Base config (`tsconfig.base.json`) with composite builds
  - Root config references all packages
  - Per-package configs with cross-references

### Docker Setup
- [ ] **Multi-stage Dockerfile**
  - Base: `node:20-alpine` with corepack
  - Build stage: workspace install + build
  - Runner stage: per-app with `ARG APP_NAME`
  - Exposes port 3000

- [ ] **Docker Compose** (`compose.yml`)
  - PostgreSQL with PostGIS (`postgis/postgis:14-3.4`)
  - Redis (v7-alpine)
  - API Gateway service
  - Persistent volumes for postgres data

- [ ] **Docker Compose Override** (`compose.override.yml`)
  - Dev mode: `pnpm dev` command
  - Volume mounts: code + node_modules

### Environment & Config
- [ ] **Environment Variables** (create `.env`)
  ```
  NODE_ENV
  PORT / APP_PORT
  HOST
  DATABASE_URL
  REDIS_HOST
  REDIS_PORT
  JWT_SECRET
  JWT_EXPIRES_IN
  CORS_ORIGIN
  LOGGING_TOKEN (Logtail)
  LOGGING_URL (Logtail)
  ```

- [ ] **Shell Aliases** (`activate.sh` + `conf/.dev_aliases`)
  - `dcu` - docker-compose up -d
  - `dcd` - docker-compose down
  - `dcr` - docker-compose rebuild
  - `dcl` - docker-compose logs
  - `dca` - docker-compose ps
  - `dc` - exec into api-gateway
  - `dd` - exec into postgres

- [ ] **Code Formatting** (`.prettierrc`)
  - Semi: true
  - Single quotes: true
  - Trailing comma: all
  - Print width: 100
  - Tab width: 2

---

## 📦 Package Structure

### Root Package (`/`)
- [ ] Dependencies
  - All workspace dependencies aggregated
  - `nodemon`, `pino`, `prisma`, `ts-node`, `typescript`

- [ ] Scripts
  - `build`: `turbo run build`
  - `dev`: `turbo run dev`
  - `format`: prettier formatting

### API Gateway (`apps/api-gateway/`)
- [ ] **Dependencies**
  - Core: `express`, `dotenv`
  - Auth: `jsonwebtoken` (replace `@fastify/jwt`)
  - Cache: `ioredis` (replace `@fastify/redis`)
  - Logging: `pino`, `express-pino-logger`, `@logtail/pino`
  - Validation: `zod`
  - Security: `helmet`, `cors`, `compression`
  - Dev: `nodemon`, `ts-node`, `typescript`

- [ ] **Dev Dependencies**
  - `@types/node`
  - `@types/express`
  - `@types/jsonwebtoken`
  - `@types/cors`
  - `@types/compression`
  - `@types/express-pino-logger`
  - `prisma`
  - `ts-node`
  - `typescript`

- [ ] **Scripts**
  - `build`: `tsc -p tsconfig.json`
  - `dev`: `nodemon --exec 'node --loader ts-node/esm' src/app.ts`
  - `start`: `node ./dist/app.js`

- [ ] **TypeScript Config**
  - Extends base config
  - Output: `./dist`
  - Root: `./src`
  - References: `common` package

### Common Package (`packages/common/`)
- [ ] **Dependencies**
  - `@prisma/client`
  - `dotenv`
  - `zod`

- [ ] **Dev Dependencies**
  - `@types/node`
  - `prisma`

- [ ] **Scripts**
  - `build`: `tsc -p tsconfig.json`
  - `dev`: `tsc -w`
  - `postinstall`: `prisma generate`

- [ ] **Prisma Schema Location**
  - `prisma/schema.prisma`

---

## 🗄️ Database (Prisma + PostgreSQL)

### Prisma Schema (`packages/common/prisma/schema.prisma`)

- [ ] **Enums**
  - `RideStatus`: REQUESTED, ACCEPTED, STARTED, COMPLETED, CANCELLED

- [ ] **Models**

  **User Model**
  - [ ] `id` - String (cuid)
  - [ ] `name` - String (optional)
  - [ ] `number` - String (unique)
  - [ ] `password` - String
  - [ ] `createdAt` - DateTime (auto)
  - [ ] `updatedAt` - DateTime (auto)
  - [ ] Relations: `driver`, `rider`

  **Driver Model**
  - [ ] `id` - String (cuid)
  - [ ] `userId` - String (unique, FK to User)
  - [ ] `isActive` - Boolean (default: false)
  - [ ] `location` - Point (PostGIS)
  - [ ] Relations: `user`, `trips[]`

  **Rider Model**
  - [ ] `id` - String (cuid)
  - [ ] `userId` - String (unique, FK to User)
  - [ ] Relations: `user`, `trips[]`

  **Trip Model**
  - [ ] `id` - String (cuid)
  - [ ] `riderId` - String (FK to Rider)
  - [ ] `driverId` - String (optional, FK to Driver)
  - [ ] `status` - RideStatus (default: REQUESTED)
  - [ ] `pickupLocation` - Point (PostGIS)
  - [ ] `dropoffLocation` - Point (PostGIS)
  - [ ] `createdAt` - DateTime (auto)
  - [ ] `completedAt` - DateTime (optional)
  - [ ] Relations: `rider`, `driver`

- [ ] **Prisma Client Generation**
  - Generated on `postinstall`
  - Output: `node_modules/.pnpm/.../prisma-client`

---

## 🔐 Validation Schemas (Zod)

### User Schemas (`packages/common/schemas/user.schema.ts`)

- [ ] **initialRegistraionSchema**
  ```typescript
  body: {
    email: z.email(),
    password: z.string(),
    role: z.enum(['d', 'r']) // d=driver, r=rider
  }
  ```

- [ ] **secondaryRegstration** (incomplete)
  ```typescript
  body: {
    name: z.string(),
    number: z.coerce.string().min(10)
  }
  ```

---

## 🚀 API Gateway Application Structure

### Directory Structure
```
apps/api-gateway/src/
├── middleware/          # Express middleware
│   └── validate.ts      # Zod validation middleware
├── plugins/             # Utilities (JWT, etc.)
│   └── jwt.ts          # JWT auth middleware
├── routes/              # Route handlers
│   └── auth.routes.ts  # Authentication routes
├── types/               # TypeScript definitions
│   └── express.d.ts    # Express Request extensions
├── utils/               # Helper utilities
│   └── redis.ts        # Redis client
├── app.ts              # Main entry point
└── logger.ts           # Pino logger setup
```

### Core Files to Implement

#### 1. Logger Setup (`src/logger.ts`)
- [ ] Initialize Pino logger
  - Dev mode: `pino-pretty` with colorized output
  - Prod mode: `@logtail/pino` transport
- [ ] Create Express app instance
- [ ] Attach `express-pino-logger` middleware
- [ ] Add body parsing (JSON + urlencoded)
- [ ] Global error handling middleware
  - Catch ZodError → 400 with validation errors
  - Catch generic Error → 500
- [ ] Export: `app` and `logger`

#### 2. Redis Client (`src/utils/redis.ts`)
- [ ] Initialize ioredis client
  - Host: from env or 'redis'
  - Port: from env or 6379
  - Retry strategy: exponential backoff (max 2s)
  - Reconnect on error: true
- [ ] Event handlers
  - `connect` - log connection
  - `ready` - log ready
  - `error` - log error
  - `close` - log close
  - `reconnecting` - log reconnecting
- [ ] Graceful shutdown on SIGINT
- [ ] Export: redis instance

#### 3. JWT Utilities (`src/plugins/jwt.ts`)
- [ ] Configuration
  - JWT_SECRET from env
  - JWT_EXPIRES_IN from env (default '1h')
- [ ] Functions
  - `generateToken(payload)` - create JWT
  - `verifyToken(token)` - verify & decode JWT
  - `decodeToken(token)` - decode without verification
- [ ] Middleware
  - `authenticate` - verify Bearer token, attach user to req
  - `optionalAuthenticate` - verify if present, don't fail
- [ ] Error handling with proper logging

#### 4. Validation Middleware (`src/middleware/validate.ts`)
- [ ] `validateBody(schema)` - validate req.body
- [ ] `validateQuery(schema)` - validate req.query
- [ ] `validateParams(schema)` - validate req.params
- [ ] `validateRequest(schema)` - validate all three
- [ ] Return 400 with Zod issues on validation failure
- [ ] Log validation failures

#### 5. Auth Routes (`src/routes/auth.routes.ts`)
- [ ] Create Express Router
- [ ] Routes:
  - **POST `/api/register/basic`**
    - Validate with `initialRegistraionSchema`
    - Return success with email
    - Status: 200
- [ ] Export router as default

#### 6. Type Extensions (`src/types/express.d.ts`)
- [ ] Extend Express.Request interface
  - Add `user?` property with:
    - `userId?: string`
    - `email?: string`
    - `role?: string`
    - Additional properties as needed

#### 7. Main App (`src/app.ts`)
- [ ] Import dependencies
  - app, logger from logger.ts
  - redis from utils/redis.ts
  - security middleware (helmet, cors, compression)
  - route modules
- [ ] Apply middleware
  - helmet() - security headers
  - cors() - CORS with configurable origin
  - compression() - gzip compression
- [ ] Health check route
  - `GET /health`
  - Check Redis ping
  - Return: status, redis status, timestamp
  - 200 if healthy, 503 if unhealthy
- [ ] Register routes
  - `/api` prefix → auth routes
- [ ] 404 handler
- [ ] Server startup
  - Port from env or 3000
  - Host from env or 0.0.0.0
  - Test Redis connection
  - Start listening
  - Log server address
- [ ] Graceful shutdown
  - SIGTERM handler
  - SIGINT handler
  - Close Redis connection
  - Force exit after 10s timeout

---

## 🔌 API Endpoints

### Health & Status
- [ ] `GET /health` - Health check with Redis status

### Authentication
- [ ] `POST /api/register/basic` - Initial user registration
  - Body: `{ email, password, role }`
  - Response: `{ success: true, message, data: { email } }`

---

## ⚙️ Middleware Stack (Order Matters)

1. [ ] Pino logger (`express-pino-logger`)
2. [ ] Body parser (JSON + urlencoded)
3. [ ] Helmet (security headers)
4. [ ] CORS (cross-origin requests)
5. [ ] Compression (gzip)
6. [ ] Routes
7. [ ] 404 handler
8. [ ] Error handler (must be last)

---

## 🧪 Testing Checklist (Future)

- [ ] Unit tests for utilities (JWT, validation)
- [ ] Integration tests for routes
- [ ] Redis connection tests
- [ ] Database tests with Prisma
- [ ] E2E tests with supertest

---

## 📝 Documentation to Create

- [ ] **README.md** - Project overview
- [ ] **ONBOARDING.md** - Developer setup guide
- [ ] **API.md** - API documentation
- [ ] **.env.example** - Environment variable template
- [ ] **CHANGELOG.md** - Version history

---

## 🚧 Incomplete/Future Features

- [ ] **JWT Plugin** (`src/plugins/jwt.ts`) - decorator implementation incomplete
- [ ] **Secondary Registration** - name + phone number endpoint
- [ ] **Login/Logout** endpoints
- [ ] **Password hashing** (bcrypt/argon2)
- [ ] **Refresh tokens**
- [ ] **Rate limiting**
- [ ] **Request validation** for all routes
- [ ] **Error tracking** (Sentry?)
- [ ] **API versioning** (v1, v2)
- [ ] **Swagger/OpenAPI** documentation
- [ ] **Database migrations** (Prisma migrate)
- [ ] **Database seeding** (`prisma/seed.ts` exists but not implemented)
- [ ] **Trip management** routes (CRUD)
- [ ] **Driver location** updates (WebSocket/SSE?)
- [ ] **Ride matching** algorithm
- [ ] **Real-time updates** (Socket.io?)
- [ ] **Payment integration**
- [ ] **Notifications** (email/SMS/push)

---

## ✅ Migration Verification Steps

1. [ ] Install all dependencies (`pnpm install`)
2. [ ] Build all packages (`pnpm build`)
3. [ ] Fix TypeScript errors
4. [ ] Start Docker services (`dcu`)
5. [ ] Test health endpoint (`curl localhost:3000/health`)
6. [ ] Test Redis connection in health check
7. [ ] Test registration endpoint
8. [ ] Verify request validation errors
9. [ ] Verify error logging
10. [ ] Verify graceful shutdown (Ctrl+C)

---

## 🎯 Express Rewrite Priority Order

### Phase 1: Foundation (Essential)
1. ✅ Update package.json dependencies
2. ✅ Create logger setup (Pino + Express)
3. ✅ Create Redis client (ioredis)
4. ✅ Create JWT utilities
5. ✅ Create validation middleware
6. ✅ Update route handlers to Express
7. ✅ Create main app entry point
8. ✅ Update TypeScript types

### Phase 2: Testing & Verification
9. [ ] Install dependencies
10. [ ] Fix build errors
11. [ ] Test health endpoint
12. [ ] Test registration endpoint
13. [ ] Verify logging works
14. [ ] Verify error handling

### Phase 3: Enhancement
15. [ ] Add more routes (login, profile, etc.)
16. [ ] Add database integration
17. [ ] Add proper password hashing
18. [ ] Add request rate limiting
19. [ ] Add API documentation
20. [ ] Add integration tests

---

## 📊 Current Status

- **Routes Implemented**: 1 (basic registration)
- **Database Models**: 4 (User, Driver, Rider, Trip)
- **Validation Schemas**: 2 (initial + secondary registration)
- **Middleware**: Basic (validation, JWT auth)
- **Services**: Redis client
- **Docker**: Multi-stage + compose
- **Monorepo**: Fully configured

---

## 🔑 Key Decisions & Rationale

- **Why Express?**: Developer familiarity, larger ecosystem
- **Why Monorepo?**: Share code (Prisma, schemas) across services
- **Why Turborepo?**: Fast builds with caching
- **Why Pino?**: High-performance JSON logging
- **Why Zod?**: Type-safe validation with TypeScript
- **Why ioredis?**: Better TypeScript support than node-redis
- **Why PostGIS?**: Geospatial queries for driver locations

---

## 📞 Next Steps After Rebuild

1. Implement authentication flow (register → login → JWT)
2. Add driver-specific endpoints (location updates, availability)
3. Add rider-specific endpoints (request ride, view history)
4. Implement trip matching logic
5. Add real-time updates (WebSocket)
6. Integrate payment system
7. Add comprehensive testing
8. Set up CI/CD pipeline
9. Deploy to staging environment
10. Performance testing & optimization

---

**Last Updated**: Migration from Fastify to Express in progress
**Target Completion**: TBD