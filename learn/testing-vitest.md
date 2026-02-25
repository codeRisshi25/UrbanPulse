# Testing with Vitest & GitHub Actions CI

Learning document for the testing setup introduced in this PR.

---

## 1. Why Vitest (not Jest)?

This project is **ESM-only** (`"type": "module"` in every `package.json`). Jest has historically had poor native ESM support. Vitest is built on Vite, which handles ESM natively — no transform workarounds needed.

Key advantages over Jest:
- Native ESM support
- Much faster (uses esbuild under the hood)
- Same API as Jest (`describe`, `it`, `expect`, `vi` ≈ `jest`)
- `vi.mock` hoisting works the same way as Jest's `jest.mock`

---

## 2. `vitest.config.ts` — Configuration Anatomy

```ts
export default defineConfig({
  test: {
    globals: true,          // no need to import describe/it/expect in every file
    environment: 'node',    // don't emulate browser DOM
    clearMocks: true,       // vi.fn() call history cleared between tests
    restoreMocks: true,     // vi.spyOn mocks restored between tests
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      common: '/path/to/packages/common/dist/index.js',
    },
  },
});
```

`globals: true` means you can write `describe(...)` without importing — Vitest injects them. The `resolve.alias` is critical for monorepo workspace packages that aren't auto-resolved by Vitest (unlike TypeScript, Vitest resolves at runtime).

---

## 3. `vi.hoisted` — The Key to Correct Mocking

This is the most important pattern in this codebase.

**The problem without `vi.hoisted`:**
```ts
// ❌ This FAILS in Vitest/Jest because vi.mock is hoisted to the TOP of the file,
// but const declarations stay in place — so mockObj is undefined when vi.mock runs.
const mockObj = { findUnique: vi.fn() };
vi.mock('../utils/db.js', () => ({ default: mockObj })); // mockObj is undefined here!
```

**The fix with `vi.hoisted`:**
```ts
// ✅ vi.hoisted executes BEFORE the module is even imported — safe to use in factory
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
```

`vi.hoisted` lifts the callback to the very top of the file's execution, before imports. The factory for `vi.mock` then captures `prismaMock` correctly.

---

## 4. `vi.mock` — Path Resolution Rules

**Critical rule**: `vi.mock` paths are **resolved relative to the test file**, not relative to the module under test.

```
Project structure:
  src/
    utils/
      db.ts          ← actual file
    services/
      auth.service.ts ← imports '../utils/db.js'
      __tests__/
        auth.service.test.ts ← test file
```

From `__tests__/auth.service.test.ts`, to mock `src/utils/db.ts`:
```ts
vi.mock('../../utils/db.js', ...);  // ✅ go up 2 levels from __tests__/
vi.mock('../utils/db.js', ...);     // ❌ resolves to src/services/utils/db.js (doesn't exist)
```

---

## 5. Mocking Module Default Exports

Many Node.js utilities use `export default`. To mock them:

```ts
vi.mock('../../utils/db.js', () => ({
  default: prismaMock,   // ← must use 'default' key for default exports
}));
```

For named exports:
```ts
vi.mock('../../utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  comparePassword: vi.fn(),
}));
```

---

## 6. `vi.fn()` — Mock Functions

```ts
const mockFn = vi.fn();

// Set return value for all calls:
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue({ id: 'user-1' }); // for async (returns a Promise)

// Set return value for just the NEXT call:
mockFn.mockResolvedValueOnce(null);

// Assert usage:
expect(mockFn).toHaveBeenCalledOnce();
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).not.toHaveBeenCalled();
```

`vi.mocked(fn)` wraps a function that TypeScript knows is a mock, providing type-safe access to `.mockResolvedValue` etc.

---

## 7. Testing the Zod `.refine()` — Cross-Field Validation

When you have conditional validation (e.g., "location is required when going online"), the error is attached to the specific path you specified in the schema:

```ts
// Schema:
.refine(
  (data) => !data.isActive || data.location !== undefined,
  { message: '...', path: ['location'] }  // path relative to the object being refined
)
```

In the test, the full error path includes the parent key (`body`):
```ts
const paths = result.error.issues.map((i) => i.path.join('.'));
expect(paths).toContain('body.location');  // 'body' + '.' + 'location'
```

`.safeParseAsync` is used instead of `.parseAsync` so that failures don't throw — they return `{ success: false, error }`.

---

## 8. Mocking `prisma.$queryRaw`

`$queryRaw` is used for PostGIS spatial queries. It's just a function on the Prisma client, so mocking it is the same as any other function:

```ts
prismaMock.$queryRaw.mockResolvedValue([
  { id: 'trip-1', pickupLocation: 'POINT(77.5946 12.9716)', ... }
]);
```

The `prismaMock.$transaction` mock needs special handling because the service passes an async callback to it:

```ts
prismaMock.$transaction.mockImplementation(
  async (fn) => fn(prismaMock)  // call the callback with the mock as the tx client
);
```

---

## 9. GitHub Actions CI Workflow

**File:** `.github/workflows/ci.yml`

```yaml
on:
  pull_request:
    branches: [main]   # runs on every PR targeting main
  push:
    branches: [main]   # also runs on direct pushes to main
```

### Key steps

```yaml
- uses: pnpm/action-setup@v4   # installs pnpm (not included by default in runners)
- uses: actions/setup-node@v4
  with:
    cache: 'pnpm'              # caches node_modules across runs = faster CI

- run: pnpm install --frozen-lockfile  # --frozen-lockfile = fail if pnpm-lock.yaml is stale
- run: pnpm --filter common build      # build common first (api-gateway depends on its dist/)
- run: pnpm --filter api-gateway test  # run tests only in api-gateway (no infra needed)
```

`--filter <package-name>` is pnpm's way to run commands scoped to a specific workspace. Equivalent to `cd packages/common && pnpm build`.

### Why no Docker / DB / Redis in CI?

These tests are **unit tests** — they mock Prisma and Redis. No real infrastructure is needed. Integration tests (with real DB+Redis) can be added as a separate workflow triggered on merge to main, using GitHub Actions services:

```yaml
services:
  postgres:
    image: postgis/postgis:14-3.4
    env:
      POSTGRES_PASSWORD: test
  redis:
    image: redis:7
```

---

## 10. Test file naming & location

Tests live at `src/services/__tests__/` and `src/schemas/`. The `include: ['src/**/*.test.ts']` glob in `vitest.config.ts` picks up any `*.test.ts` file anywhere under `src/`.

Convention:
- `auth.service.test.ts` tests `auth.service.ts`
- `driver.service.test.ts` tests `driver.service.ts`
- `schemas.test.ts` tests all Zod schemas

---

## Summary — Testing Strategy by Milestone

| Milestone | Test type added |
|-----------|----------------|
| M1 (current) | Unit tests for 3 services + Zod schemas; GitHub Actions CI |
| M3 (Socket.io) | Unit tests for socket event handlers (mock socket.io) |
| M4 (Matching) | Unit tests for matching algorithm (pure logic, no I/O) |
| M5 (Complete) | Integration tests with Docker Compose services (real DB+Redis) |
