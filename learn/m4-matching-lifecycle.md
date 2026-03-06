# M4 — Driver Matching & Ride Lifecycle

> **Branch:** `feature/m4-matching-lifecycle` | **Closes:** Issue #9

---

## What this milestone does

M4 turns the skeleton workers from M2 into a working ride-sharing pipeline. When a rider requests a ride, the system now:

1. Searches for the nearest available driver using Redis GEO
2. Sends them a ride offer with a 30-second timeout
3. If they don't respond, cascades to the next closest driver
4. When accepted, generates a 4-digit OTP for pickup verification
5. When the OTP is verified, the ride starts

---

## Cascade Matching — How it works

```
Rider requests ride
    │
    ▼
ride-request worker → publishes to ride-matching queue
    │
    ▼
ride-matching worker
    │
    ├── GEOSEARCH Redis GEO (5km radius, sorted by distance)
    ├── Filter out drivers:busy set (currently on a ride)
    ├── Filter out already-offered drivers
    │
    ├── FOUND: Send offer to nearest driver
    │   ├── Create RideOffer record (PENDING, 30s expiry)
    │   ├── Emit ride:offer to driver:{userId} room via Redis pub/sub
    │   └── Schedule delayed timeout job (30s)
    │
    ├── TIMEOUT: Offer still PENDING after 30s?
    │   ├── Mark EXPIRED
    │   ├── Notify driver (ride:offer-expired)
    │   └── Cascade to next driver
    │
    └── NO DRIVERS: Expand to 10km → still none? → CANCEL trip
```

### Why Redis GEO + Redis Set?

- **Redis GEO** (`GEOSEARCH`) returns drivers sorted by distance in O(log(N)+M) — faster than any SQL query
- **`drivers:busy` set** is an O(1) membership check — avoids N separate DB lookups to check if each driver is on a ride

---

## Ride State Machine

```
REQUESTED ──→ ACCEPTED ──→ STARTED ──→ COMPLETED (M5)
    │             │
    └──→ CANCELLED ←──┘
```

Invalid transitions (e.g., REQUESTED→STARTED) throw immediately. Terminal states (COMPLETED, CANCELLED) allow no further transitions.

**File:** `apps/ride-worker/src/state-machine.ts`

---

## OTP System

| Step | What happens |
|------|-------------|
| 1. Generate | 4-digit random: `Math.floor(1000 + Math.random() * 9000)` |
| 2. Store | Redis `otp:{tripId}` with 15-minute TTL + DB `Trip.otp` for audit |
| 3. Verify | Driver submits OTP at pickup via `POST /rides/:tripId/verify-otp` |
| 4. Max attempts | 3 tries (tracked in Redis `otp:attempts:{tripId}`). Exceeded → auto-cancel |
| 5. On match | Trip status → STARTED, OTP keys deleted from Redis |

---

## Race Condition Protection — SETNX Lock

Two drivers could try accepting the same ride simultaneously. Solution:

```
Driver A: SETNX ride:lock:{tripId} → OK (wins)
Driver B: SETNX ride:lock:{tripId} → null (already locked!)
           └── "Ride has already been accepted by another driver"
```

The lock has a 300-second TTL as a safety net.

---

## Socket Events (new)

| Event | Direction | Payload |
|-------|-----------|---------|
| `ride:offer` | server→driver | `{ tripId, offerId, pickupLng/Lat, dropoffLng/Lat }` |
| `ride:offer-expired` | server→driver | `{ tripId, offerId }` |
| `ride:accepted` | server→rider | `{ tripId, driverId }` |
| `ride:otp` | server→rider | `{ tripId, otp }` |
| `ride:started` | server→ride room | `{ tripId }` |
| `ride:cancelled` | server→ride room + rider | `{ tripId, reason }` |
| `ride:otp-error` | server→driver | `{ tripId, message, remainingAttempts }` |
| `driver:accept-ride` | driver→server | `{ tripId, offerId }` |
| `driver:reject-ride` | driver→server | `{ tripId, offerId }` |

---

## REST Endpoints (new)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/rides/:tripId/accept` | driver | Accept ride (SETNX lock) |
| POST | `/rides/:tripId/reject` | driver | Reject → cascade |
| POST | `/rides/:tripId/verify-otp` | driver | OTP verification |
| POST | `/rides/:tripId/driver-cancel` | driver | Driver cancels accepted ride |
| PATCH | `/rides/cancel` | rider | Enhanced with `{ tripId }` body |

---

## Schema Changes

Added to **Trip**: `otp String?`, `fare Float?`, `distance Float?`

New model **RideOffer**: `id`, `tripId`, `driverId`, `status (PENDING|ACCEPTED|REJECTED|EXPIRED)`, `createdAt`, `expiresAt`

---

## Cross-Process Socket Emission

The ride-worker has no direct Socket.io connections — those live in api-gateway. It emits events via Redis pub/sub:

```ts
await redis.publish('socket.io#/#', JSON.stringify({
  type: 2,
  data: ['ride:offer', payload],
  nsp: '/',
  rooms: ['driver:userId123'],
}));
```

The api-gateway's Redis adapter picks this up and delivers to the correct socket.

---

## What's next (M5)?

M5 will implement ride completion with fare calculation — the `STARTED → COMPLETED` transition that the state machine already allows.
