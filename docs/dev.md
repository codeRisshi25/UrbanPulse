## Top-level summary

- Monorepo manager: pnpm workspaces (pnpm@10.18.0) + Turborepo (turbo) for orchestration & caching.
- Packages layout: workspace globs are `apps/*` and `packages/*` (see pnpm-workspace.yaml).
- TypeScript project references + composite builds (root tsconfig.json, package tsconfig.json with `references`).
- App shown: api-gateway (Fastify + Redis + TS). Shared code: common (Prisma schema, shared schemas, utilities).
- DB: PostgreSQL with PostGIS (docker image `postgis/postgis:14-3.4`).
- Orchestration for dev: Docker Compose + a compose override for development (bind-mount + `pnpm dev` in container). Local dev can run `pnpm dev` at the root (which runs Turbo).
- Build & Docker: multi-stage Dockerfile that runs pnpm install at workspace level and `pnpm build` then produces per-app runner images via `ARG APP_NAME`.

## Important files (what they are / purpose)

- pnpm-workspace.yaml — declares workspace packages (apps/_, packages/_).
- package.json (root) — workspace scripts:
  - "build": "turbo run build"
  - "dev": "turbo run dev"
  - packageManager pinned: `pnpm@10.18.0`
  - devDependencies include `turbo`
- turbo.json — Turbo task config:
  - `build` depends on `^build` (build dependency propagation across workspace)
  - `dev` configured with pass-through env variables (NODE*ENV, LOGGING_TOKEN, APP_PORT, DATABASE_URL, REDIS*\* etc.)
- tsconfig.base.json — base TypeScript compiler options (composite true, declaration, module nodenext, target ES2022, strict).
- tsconfig.json (root) — references api-gateway and common (TypeScript project references).
- package.json — app-specific scripts:
  - `build`: `tsc -p tsconfig.json`
  - `dev`: `nodemon --exec 'node --loader ts-node/esm' src/index.ts` (TS runtime dev)
  - depends on `common` via `"common": "workspace:^"`
- package.json — shared utilities, prisma config, `postinstall: prisma generate` (generates Prisma client).
- schema.prisma — DB schema (Prisma).
- Dockerfile — multi-stage; installs pnpm and workspace deps and runs `pnpm build`. Multi-app by ARG `APP_NAME` used to copy built `dist` for specific app into runner image.
- compose.yml & compose.override.yml — production base compose and development override (override sets `command: pnpm dev` and mounts repo).
- activate.sh + .dev_aliases — helpful developer shell aliases for docker-compose commands (dcu, dcr, etc).

## Monorepo wiring — how pieces relate

- pnpm workspace: root pnpm-workspace.yaml + workspace references in package.json (`"common": "workspace:^"`) allow installing & linking local packages.
- TypeScript project references: packages are built with `tsc -p tsconfig.json` and `tsconfig` references allow incremental/project composite builds. Root `tsconfig` references app & package; `tsconfig.base` sets `composite: true` required for cross-project builds.
- Turborepo: turbo orchestrates commands across the workspace. Root `pnpm build` calls `turbo run build`, which runs `build` scripts in packages in dependency order (because `build` depends on `^build`). Turbo caches outputs (the .turbo directory) to speed repeated builds.
- Docker build: Dockerfile copies only minimal package.json and lockfiles then runs `pnpm i` to install workspace deps, copies source, runs `pnpm build`, and finally builds a runner image that contains node_modules and the built `dist` for the selected `APP_NAME`. Compose sets the arg `APP_NAME: api-gateway`.
- Prisma: schema in prisma. common has `postinstall: prisma generate` so after installation the Prisma client should be generated (client ends up under client and/or generated folder). There's an explicit `packages/common/generated/prisma` folder in repo (generated client present).

## Tech stack (concise)

- Language & tooling: TypeScript (TS 5+), Node.js (Docker image uses node:20-alpine).
- Monorepo & package manager: pnpm workspaces, Turbo (turborepo) for task orchestration.
- Web framework: Fastify (v5) — api-gateway uses fastify + `@fastify/redis`.
- Logging: pino via `@logtail/pino` integration (logger.ts).
- Validation: Zod (shared schemas).
- ORM / DB: Prisma v6 + PostgreSQL with PostGIS (spatial types used with `Unsupported("Point")` in schema).
- Caching: Redis (`@fastify/redis`).
- Dev runtime: `ts-node` / `nodemon` for local dev in app packages.
- Lint/format: Prettier config present; no ESLint config visible.
- Containerization: Docker multi-stage; Docker Compose for local/compose orchestration.

## Build & dev workflows (practical step-by-step)

Local machine (preferred quick start)

1. Ensure Node & pnpm:
   - Use corepack or install pnpm. Example:
     ```bash
     corepack enable
     corepack prepare pnpm@10.18.0 --activate
     ```
2. Install dependencies (workspace):
   ```bash
   pnpm install
   ```
   This runs `postinstall` scripts (Prisma generate for common).
3. Create .env with required variables (no `.env.example` provided — see variables used in turbo.json and api-gateway):
   - at minimum: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `APP_PORT`, `LOGGING_TOKEN`, `LOGGING_URL`
4. Run development mode (root):
   ```bash
   pnpm dev
   ```

   - This runs `turbo run dev` which executes `dev` script in each package (app dev uses nodemon + ts-node).
   - Alternative: run the api-gateway dev directly:
     ```bash
     cd apps/api-gateway
     pnpm dev
     ```

Docker / container development

- Start DB & app together (development override runs `pnpm dev` in container and mounts code):
  ```bash
  # from repo root
  docker compose -f compose.yml -f compose.override.yml up --build
  ```
  or invoke aliases after `source activate.sh` and then `dcu` / `dcr` per repo's alias file.

Production Docker build (example)

- The Dockerfile expects build-time arg `APP_NAME`. Example for api-gateway:
  ```bash
  docker build --build-arg APP_NAME=api-gateway -t myorg/api-gateway:latest .
  docker run -p 3000:3000 --env-file .env myorg/api-gateway:latest
  ```
  Compose compose.yml already passes `APP_NAME: api-gateway` in the `build` args.

Prisma (migrations & client)

- Prisma client is generated on install (`postinstall` in common). If you change schema:
  ```bash
  cd packages/common
  pnpm prisma generate
  pnpm prisma migrate dev --name some_migration   # if you use Prisma Migrate (no migration scripts present in repo; add if needed)
  ```

## Typical dev tasks & commands (quick cheat sheet)

- Install deps: `pnpm install`
- Run all dev tasks via turbo: `pnpm dev`
- Build all packages: `pnpm build`
- Build a specific package: `pnpm --filter api-gateway build` (pnpm filter syntax)
- Start Docker compose (dev): `docker compose -f compose.yml -f compose.override.yml up --build`
- Enter container: `docker compose exec api-gateway /bin/bash` (or use provided `dc` alias)
- Generate Prisma client: `pnpm --filter common prisma generate` or `cd packages/common && pnpm prisma generate`

## How to add a new app/service (high level)

1. Create new folder `apps/<your-app>`, add package.json with script names `build` and `dev`.
2. Add tsconfig.json that extends root/base config and, if needed, `references` to common.
3. Add the package to workspace implicitly by path; `pnpm install` will pick it up (pnpm-workspace.yaml includes `apps/*`).
4. Add any workspace dependency references via `"workspace:^"` to reuse `common`.
5. Update Dockerfile or compose if you want to build a runner image for that service (pass `APP_NAME` to Docker build).

## Onboarding checklist & knowledge transfer (practical)

- Prereqs:
  - Install Node 20.x (or use Docker), enable corepack and pnpm v10.18.0.
  - Docker & docker-compose v2 for container workflows.
- Environment:
  - Create .env in repo root with at least `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `APP_PORT`. Ensure credentials and DB exist or use compose to spin up DB.
- Start dev:
  - Option A (local): `pnpm install && pnpm dev`
  - Option B (docker): `docker compose -f compose.yml -f compose.override.yml up --build`
- DB tasks:
  - If you change Prisma schema, run `prisma migrate` or `prisma db push` depending on workflow, then `prisma generate`.
- Where to look first:
  - index.ts — main server bootstrap, registers redis and routes.
  - schema.prisma — domain model.
  - schemas — shared validation schemas (Zod).
  - turbo.json and pnpm-workspace.yaml — workspace orchestration.

## Pitfalls & gotchas to watch for

- Prisma + migrations:
  - The repo contains Prisma schema and a generated client folder. Ensure `DATABASE_URL` is correct and migrations are applied (there are no migration files in repo).
- Docker bind-mounts:
  - compose.override.yml mounts `.` into `/app` and `/app/node_modules` as anonymous volume; this can hide node_modules installed in the image. For dev this is expected but can cause mismatch with installed versions or generated Prisma client in node_modules.
- `nodemon` + `ts-node` loader:
  - api-gateway dev uses `node --loader ts-node/esm` which requires that ts-node and node flags match your environment.
- TypeScript project references:
  - Building with `tsc -b` (composite) is necessary for correct declaration and cross-package references — don't just compile single package if you rely on emitted outputs from `common`.
- Dockerfile expectation:
  - Multi-stage build copies `apps/${APP_NAME}/dist`; make sure `pnpm build` created dist for the requested app. The image will fail if the dist is missing.
- Env variables & secrets:
  - .env not in repo. Ensure you secure secrets in real deployments.

## Small low-risk improvements I recommend

- Add a `.env.example` listing required environment variables and example values.
- Add a README README.md explaining app-level commands and env vars.
- Add basic CI (GitHub Actions) to run `pnpm install` + `pnpm build` to ensure workspace builds succeed on PRs.
- Add `pnpm` workspace-aware scripts to run tests or linters if added later (e.g., `pnpm -w lint`).
- Add a `Makefile` or top-level dev script to make common tasks discoverable for new devs.

## Requirements coverage (your list → status)

- "Analyze whole codebase" → Done (inspected top-level manifest, workspace, turbo, tsconfig, Docker, compose, Prisma, app code).
- "Explain monorepo setup" → Done (pnpm workspace + TypeScript project refs + turbo).
- "Explain tooling, workflow and build process" → Done (dev, build, Docker, Prisma notes + commands).
- "Explain tech stack and knowledge transfer" → Done (stack list + onboarding checklist + pitfalls + recommended improvements).

If you want, I can next:

- Produce a short `ONBOARDING.md` file with the exact commands and env example and add it to the repo.
- Create a minimal GitHub Actions workflow that runs `pnpm install` and `pnpm build` (CI smoke test).
- Run a local build to confirm `pnpm build` completes successfully in this environment (I can run it and report results).

Which of the three next steps above would you like me to do for you now?
