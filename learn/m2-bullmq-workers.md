# M2 — BullMQ Ride Queue & Worker App

Learning document for the code changes introduced in Milestone 2.

---

## 1. Why a Separate Worker Process?

**Problem:** If the api-gateway processes driver matching synchronously inside the HTTP request, a slow database query or downstream failure blocks the client and ties up a Node.js thread.

**Solution:** The api-gateway becomes the *producer* — it writes work to a queue and responds immediately. A separate `ride-worker` process is the *consumer* — it pulls jobs from the queue and does the heavy lifting independently.

```
Client  →  POST /rides/create  →  api-gateway  →  Queue (ride-requests)  →  ride-worker
                ↑                                                                  |
            responds with                                                   DB update +
           { id, status: "REQUESTED" }                                      cascade matching
```

Benefits:
- **Horizontal scaling**: run `docker compose scale ride-worker=3` to parallelize matching
- **Fault isolation**: a crash in the worker doesn't bring down the HTTP server
- **Retries**: BullMQ automatically retries failed jobs with backoff — no retry logic in business code

---

## 2. BullMQ Core Concepts

**File:** `apps/ride-worker/src/workers/ride-request.worker.ts`

BullMQ has three primitives: **Queue**, **Worker**, and **Job**.

### Queue — the producer side

```ts
import { Queue } from 'bullmq';

const rideRequestsQueue = new Queue('ride-requests', {
  connection: { host: 'localhost', port: 6379 },
});

// Publish a job
await rideRequestsQueue.add('new-ride', { tripId, riderId, pickupLng, pickupLat, ... });
```

- The queue is backed by Redis — each job is a Redis key.
- Calling `.add()` is non-blocking and returns immediately with a `Job` object.
- The second argument is the **job name** (a label). The third is the **job data** (serialised to JSON).
- `jobId` option (`{ jobId: tripId }`) prevents duplicate jobs — if a job with that ID already exists it won't be added again.

### Worker — the consumer side

```ts
import { Worker } from 'bullmq';

const worker = new Worker('ride-requests', async (job) => {
  // job.data contains everything passed to queue.add()
  const { tripId, riderId } = job.data;
  // ... process ...
}, { connection, concurrency: 5 });
```

- The `Worker` polls Redis for new jobs and calls your processor function.
- `concurrency: N` — the worker processes up to N jobs in parallel (Promise concurrency, not threads).
- If the processor throws, BullMQ marks the job `failed` and retries per the retry config.

### Job lifecycle

```
waiting → active → completed
              ↘ failed (retried up to maxAttempts)
```

---

## 3. Connection Options — Why Not Pass the ioredis Instance?

BullMQ accepts either an **ioredis `Redis` instance** or a plain **connection options object** (`{ host, port }`).

Passing the same ioredis client that the app uses for GEO commands causes a TypeScript type conflict because BullMQ's internal `Redis` type (from its own bundled ioredis types) doesn't fully align with the version imported by the app. The clean solution used here is a separate connection options object:

```ts
const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

new Queue(QUEUE_NAMES.RIDE_REQUESTS, { connection: bullmqConnection });
new Worker(QUEUE_NAMES.RIDE_REQUESTS, processor, { connection: bullmqConnection });
```

BullMQ creates its own internal ioredis connection from these options. **Important:** for Worker connections, BullMQ requires `maxRetriesPerRequest: null` — this is set in `apps/ride-worker/src/utils/redis.ts` on the ioredis client used by the app itself (for non-BullMQ operations like GEO commands).

---

## 4. Shared Queue Name Constants

**File:** `packages/common/queues/index.ts`

Both `api-gateway` (producer) and `ride-worker` (consumer) must use exactly the same queue names — a typo means jobs are published to a queue nobody reads.

```ts
export const QUEUE_NAMES = {
  RIDE_REQUESTS: 'ride-requests',   // new ride → api-gateway publishes
  RIDE_MATCHING: 'ride-matching',   // cascade matching → worker publishes (M4)
  RIDE_LIFECYCLE: 'ride-lifecycle', // state transitions → worker publishes (M4/M5)
} as const;
```

`as const` makes the values literal types (`'ride-requests'`, not `string`), so TypeScript catches misuse at compile time.

Exporting from `packages/common` ensures a single source of truth across the entire monorepo.

---

## 5. Multi-Queue Architecture

Three queues handle different stages of the ride flow:

| Queue | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| `ride-requests` | api-gateway | ride-worker | New ride enters the system |
| `ride-matching` | ride-worker | ride-worker | Cascade: offer to next driver after timeout |
| `ride-lifecycle` | ride-worker | ride-worker | State transitions: accept, start, complete, cancel |

Splitting concerns into multiple queues allows independent scaling and monitoring. A spike in new ride requests doesn't block lifecycle processing.

---

## 6. Delayed Jobs for Cascade Matching (preview of M4)

BullMQ supports **delayed jobs** natively:

```ts
await rideMatchingQueue.add(
  'match-driver',
  { tripId, attempt: 2 },
  { delay: 30_000 }, // processed 30 seconds from now
);
```

This is how the cascade timeout will work in M4:
1. Offer sent to nearest driver → delayed job scheduled for 30 s
2. 30 s later, delayed job fires → check if offer still PENDING
3. If yes → offer expired, move to next driver → schedule another 30 s job
4. Repeat until accept or no drivers left

BullMQ stores the job in a Redis sorted set ordered by `processAt` timestamp. A BullMQ internal timer moves jobs to the `waiting` state when their time arrives. No cron, no `setTimeout` — Redis + BullMQ handles everything.

---

## 7. Graceful Shutdown

**File:** `apps/ride-worker/src/index.ts`

Abruptly killing a worker mid-job can leave a job in `active` state forever (stalled). Graceful shutdown tells BullMQ to finish the current batch before exiting:

```ts
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down ride-worker...');

  // worker.close() waits for in-flight jobs to finish, then stops polling
  await Promise.all(workers.map((w) => w.close()));
  await redis.quit(); // flush pending Redis commands

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker stop / k8s eviction
process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl-C in dev
```

Docker sends `SIGTERM` before `SIGKILL` (with a 10 s grace period). Kubernetes does the same. Listening for both signals ensures a clean shutdown in all environments.

---

## 8. Mocking BullMQ in Unit Tests

BullMQ creates a Redis connection on module import (when `new Queue(...)` is called at the top-level). In tests there is no Redis, so we mock the entire module:

```ts
// Must be hoisted — vi.hoisted runs before imports
const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));

// Use a constructor function (not arrow function) because Queue is used with `new`
vi.mock('bullmq', () => {
  const QueueMock = vi.fn(function (this: Record<string, unknown>) {
    this.add = queueAddMock;
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { Queue: QueueMock };
});
```

**Why `vi.fn(function() { ... })` and not `vi.fn(() => ({ ... }))`?**

Arrow functions cannot be used as constructors (`new arrowFn()` throws `TypeError: is not a constructor`). Using a regular `function` lets `new Queue(...)` work correctly in the code under test.

**Why `vi.hoisted`?**

`vi.mock()` calls are hoisted to the top of the file by Vitest's transformer, but variable initialisers are not. `vi.hoisted()` wraps the value so it's available when the mock factory runs.

---

## Summary — What M2 enables for future milestones

| Milestone | How M2 unblocks it |
|-----------|-------------------|
| M3 — Socket.io | ride-worker will use `packages/notifications` to emit socket events via Redis adapter |
| M4 — Matching | `ride-matching` worker processes cascade; `ride-lifecycle` handles accept/OTP/start |
| M5 — Completion | `ride-lifecycle` handles COMPLETE action: distance calculation + fare + DB update |
