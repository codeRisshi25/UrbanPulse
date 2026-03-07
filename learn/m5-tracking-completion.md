# M5 — Live Location Tracking & Ride Completion

> **Branch:** `feature/m5-tracking-completion` | **Closes:** Issue #10

---

## What this milestone does

M5 completes the end-to-end ride-sharing flow. After a ride is STARTED (M4), the driver streams live location to the rider, and when the ride ends, the system calculates the fare using PostGIS.

---

## Throttled Location Broadcast

```text
Driver GPS update (every ~1s)
    │
    ▼
driver:location-update { lng, lat, heading?, speed? }
    │
    ├── Always: GEOADD Redis GEO (update position)
    │
    ├── SETNX driver:location-throttle:{userId} → 3s TTL
    │   ├── OK (allowed): proceed to broadcast
    │   └── null (throttled): skip broadcast (update still saved)
    │
    ├── Look up driver's STARTED trip
    │
    ├── PostGIS: ST_DistanceSphere(currentPos, dropoff) → remaining km
    │
    ├── ETA: remainingKm / 30 km/h * 60 → minutes
    │
    └── socket.to(ride:{tripId}).emit('ride:driver-location', {
          lng, lat, heading, speed,
          remainingDistanceKm, etaMinutes,
          timestamp
        })
```

### Why throttle?
Without throttling, a driver sending GPS every second = 60 PostGIS queries/minute + 60 socket broadcasts. With 3s throttle: 20/minute — 3x reduction.

---

## Ride Completion — COMPLETE Action

```text
POST /rides/:tripId/complete  (driver)
    │
    ▼
lifecycle queue → ride-lifecycle worker
    │
    ├── 1. Validate STARTED → COMPLETED transition
    ├── 2. PostGIS: ST_DistanceSphere(pickup, dropoff) → meters
    ├── 3. Fare: max(50, 50 + distanceKm × 12) → round to 2 decimals
    ├── 4. Update Trip: status=COMPLETED, fare, distance, completedAt
    ├── 5. Remove driver from drivers:busy set
    ├── 6. Cleanup Redis: lock, OTP keys
    └── 7. Notify ride:{tripId} room + rider room → ride:completed
```

| Constant | Value | Purpose |
|----------|-------|---------|
| BASE_FARE | 50 | Minimum base charge |
| PER_KM_RATE | 12 | Rate per kilometer |
| MIN_FARE | 50 | Floor fare |
| CITY_AVG_SPEED_KMH | 30 | ETA estimation speed |

---

## New REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/rides/:tripId/complete` | driver | Complete ride → fare calculation |
| GET | `/rides/history` | any | Paginated ride history (page/limit) |
| GET | `/rides/:tripId` | owner | Single ride detail (rider or driver) |
| GET | `/user/driver/stats` | driver | Total rides, earnings, distance |
| GET | `/user/driver/current-ride` | driver | Active ACCEPTED/STARTED ride |
| GET | `/user/rider/current-ride` | rider | Active REQUESTED/ACCEPTED/STARTED ride |

---

## Ride History — PostGIS + Raw SQL

Standard Prisma `findMany` can't handle geometry fields. Solution: `$queryRaw` with `ST_AsText`:

```sql
SELECT t.id, t.status,
       ST_AsText(t."pickupLocation") as "pickupLocation",
       ST_AsText(t."dropoffLocation") as "dropoffLocation",
       t.fare, t.distance, t."createdAt", t."completedAt"
FROM "Trip" t WHERE t."riderId" = $1
ORDER BY t."createdAt" DESC LIMIT 20 OFFSET 0
```

---

## Rider Current Ride — Driver Location from Redis

When a rider checks their active ride during `STARTED` status, the system fetches the driver's live position from Redis GEO:

```ts
const pos = await redis.geopos('drivers:active', driverUserId);
// → [[lng, lat]] or [[null, null]]
```

This avoids DB queries and gives real-time position.

---

## Complete Flow (M1–M5)

```text
1. Rider: POST /rides/create → REQUESTED
2. Worker: cascade match → nearest driver → ride:offer
3. Driver: driver:accept-ride → SETNX lock → ACCEPTED
4. Worker: OTP generated → ride:otp → rider
5. Driver arrives → rider shares OTP → POST /rides/:tripId/verify-otp → STARTED
6. Driver streams location → throttled broadcast → ride:driver-location
7. Driver: POST /rides/:tripId/complete → COMPLETED (fare + distance)
8. Both: GET /rides/history → see past rides
```
