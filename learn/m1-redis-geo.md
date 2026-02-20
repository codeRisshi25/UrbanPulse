# M1 — Redis Integration & Driver Location Service

Learning document for the code changes introduced in Milestone 1.

---

## 1. ioredis Singleton Pattern

**File:** `apps/api-gateway/src/utils/redis.ts`

### What it is
`ioredis` is the Node.js Redis client. A *singleton* means only **one** connection is created for the entire app lifetime (similar to how `PrismaClient` is singleton-ized in `db.ts`).

### Key concepts

```ts
import { Redis } from 'ioredis'; // named import — needed for ESM + TypeScript
```

`Redis` is the class. You `new Redis({ host, port })` to connect.

### globalThis caching (dev hot-reload safety)
```ts
const redis: Redis = global.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  global.redis = redis;
}
```
In development, `tsx --watch` re-evaluates the module file on every save. Without `globalThis` caching, a **new** Redis connection would be created on every hot-reload, quickly exhausting the connection pool. By storing the instance on `global`, subsequent re-evaluations reuse the same connection.

### Reconnect strategy
```ts
retryStrategy(times: number) {
  const delay = Math.min(times * 100, 3000); // 100ms, 200ms, … capped at 3s
  return delay; // returning null would stop retrying
}
```
ioredis calls this function after every failed connection attempt. Returning a number (ms) tells it to wait that long before trying again. Returning `null` stops retrying.

### Event listeners
```ts
client.on('connect', () => logger.info('Redis connected'));
client.on('error',   (err) => logger.error({ err }, 'Redis error'));
client.on('close',   () => logger.warn('Redis connection closed'));
```
These let you observe the connection lifecycle for logging and alerting.

---

## 2. Redis GEO Commands

Redis has a built-in **geospatial index** using sorted sets under the hood.

### GEOADD — store a location
```
GEOADD key longitude latitude member
```
```ts
await redis.geoadd('drivers:active', lon, lat, driverId);
```
- `drivers:active` is the key name (a Redis Sorted Set).
- `member` is the unique identifier (driver's DB id).
- Calling `GEOADD` on an existing member **updates** its position — no need to delete first.
- Coordinates follow **longitude first, latitude second** — same as PostGIS convention.

### GEOPOS — read a stored location
```ts
const positions = await redis.geopos('drivers:active', driverId);
// positions[0] = [lonString, latString] | null
```
Returns an array (one per member requested). Values are strings — always `parseFloat()` before doing math.

### GEOSEARCH / GEORADIUS — find members near a point
```ts
// Modern syntax (Redis 6.2+):
await redis.call('GEOSEARCH', key, 'FROMLONLAT', lon, lat, 'BYRADIUS', 5, 'km', 'ASC')
```
Used internally by the driver matching algorithm (M4) to find the closest available driver.

### ZREM — remove from the GEO set
```ts
await redis.zrem('drivers:active', driverId);
```
Because GEO is built on a sorted set, `ZREM` removes the member. Used when a driver goes offline.

---

## 3. TTL-based Heartbeat

**Problem:** What if a driver's app crashes without calling "go offline"? They'd stay in `drivers:active` forever — ghost drivers.

**Solution:** A *heartbeat key* with a Time-To-Live (TTL).

```ts
const HEARTBEAT_TTL_SECONDS = 60;
// Set key with automatic expiry:
await redis.set(`driver:heartbeat:${driverId}`, '1', 'EX', HEARTBEAT_TTL_SECONDS);
```

- `EX` sets expiry in **seconds**. `PX` is for milliseconds.
- Every time the driver sends a location update, TTL is **refreshed** (the key is re-SET, restarting the countdown).
- If no update arrives within 60s, Redis **automatically deletes** the key.
- A background job (or middleware) can check for existence of this key to decide if a driver is truly active. In M4, the matching worker uses this.

---

## 4. Zod Schema with `.refine()` for Conditional Validation

**File:** `packages/common/schemas/driver.schema.ts`

```ts
export const driverStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
    location: locationTuple.optional(),
  }).refine(
    (data) => !data.isActive || data.location !== undefined,
    { message: 'location is required when going online', path: ['location'] }
  ),
});
```

`.refine()` adds **cross-field validation** — something basic field validators can't do.

Logic: `!isActive || location !== undefined` means:
- If `isActive = false` → validation passes (offline doesn't need location).
- If `isActive = true` AND location is missing → validation **fails** with the provided message.

`path: ['location']` tells Zod which field to attach the error to (so the client gets a helpful error pointing at `body.location`).

---

## 5. Coordinate Tuple as Zod Type

```ts
const locationTuple = z.tuple([z.number(), z.number()]).describe('[longitude, latitude]');
```

`z.tuple([...])` validates a fixed-length array where each element can have its own type. Unlike `z.array(z.number())`, a tuple enforces **exactly** the positions specified. `.describe()` attaches human-readable documentation used by OpenAPI generators.

---

## 6. PostGIS `ST_DWithin` for Proximity Queries

**File:** `apps/api-gateway/src/services/driver.service.ts`

```sql
WHERE ST_DWithin(
  "pickupLocation"::geography,
  ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography,
  $radiusMeters
)
```

- `ST_DWithin(geom_a, geom_b, distance)` returns true if the two geometries are within `distance` of each other.
- Casting to `::geography` makes the distance unit **meters** (not degrees). This is critical — without it, the radius would be in degrees which doesn't translate meaningfully.
- `ST_MakePoint(lon, lat)` creates a geometry point. `ST_SetSRID(..., 4326)` assigns the WGS 84 coordinate system (standard GPS).
- `ST_DWithin` uses a **spatial index** (GiST index on the geometry column) for very fast bounding-box pre-filtering.

---

## 7. `authorize()` Middleware for Role-Based Access

**File:** `apps/api-gateway/src/middleware/auth.ts`

```ts
export const authorize = (...roles: Array<'driver' | 'rider'>) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) { /* 403 */ }
    next();
  };
};
```

Usage in routes:
```ts
router.patch('/driver/status', authenticate, authorize('driver'), validate(schema), handler);
```

**Middleware chain order matters:**
1. `authenticate` — verifies JWT, sets `req.user`
2. `authorize('driver')` — checks `req.user.role` (requires step 1 first)
3. `validate(schema)` — validates body/query/params
4. handler — actual business logic

---

## 8. Health Check with Async Redis Ping

```ts
router.get('/health', async (req, res) => {
  let redisStatus = 'ok';
  try {
    await redis.ping(); // Redis replies with 'PONG'
  } catch {
    redisStatus = 'error';
  }
  res.json({ services: { api: 'ok', redis: redisStatus } });
});
```

`redis.ping()` sends the simplest possible Redis command. If it throws (connection error, timeout), we catch it and report `'error'` instead of crashing the health endpoint. This pattern lets load balancers and orchestrators (Kubernetes liveness probes) detect partial outages.

---

## Summary — What M1 enables for future milestones

| Milestone | How M1 unblocks it |
|-----------|-------------------|
| M2 — BullMQ | BullMQ uses the same Redis connection for its job queues |
| M3 — Socket.io | Socket.io Redis adapter uses Redis pub/sub for cross-instance messaging |
| M4 — Matching | GEOSEARCH on `drivers:active` finds nearest online driver to a pickup point |
| M5 — Live tracking | Driver location stream updates GEO set; riders poll or subscribe for position |
