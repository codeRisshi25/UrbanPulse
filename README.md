<div align="center">

# 🚀 UrbanPulse

**Production-grade ride-sharing backend** built with a distributed microservices architecture.

*Real-time driver matching • Live GPS tracking • OTP-verified pickups • PostGIS fare calculation*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PostGIS-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-GEO%20%2B%20Pub%2FSub-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-010101?logo=socket.io&logoColor=white)](https://socket.io/)

</div>

---

## What is Urban Pulse ?

UrbanPulse is a **full ride-sharing backend** , think of it as the engine behind apps like Uber/Ola. A rider requests a ride, the system finds the nearest available driver, handles the entire lifecycle through completion, and calculates the fare , all in real-time.

It's a distributed system with **race condition protection**, **cascading driver matching**, **cross-process event emission**, and **geospatial queries** — the same patterns used in production ride-sharing platforms.

---

## The Ride Flow

```
Rider requests ride
       ↓
  Nearest driver found (Redis GEOSEARCH, 5km radius)
       ↓
  Offer sent via WebSocket → 30s timeout → cascade to next driver
       ↓
  Driver accepts (distributed SETNX lock prevents double-accept)
       ↓
  4-digit OTP generated → sent to rider
       ↓
  Driver verifies OTP at pickup → ride starts
       ↓
  Live GPS streaming (throttled, with ETA) → rider sees driver moving
       ↓
  Driver completes ride → PostGIS distance → fare calculated
       ↓
  Both see ride in history with full details
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    API Gateway                       │
│  Express REST API + Socket.io WebSocket Server       │
│  Auth (JWT) • Rate Limiting • Zod Validation         │
└──────────────┬──────────────────────┬────────────────┘
               │ BullMQ Jobs          │ Redis Pub/Sub
               ▼                      ▼
┌───────────────────────┐    ┌────────────────────┐
│     Ride Worker       │    │   Notifications    │
│  Matching • Lifecycle │    │   Socket Adapter   │
│  State Machine • OTP  │    │   Cross-process    │
└──────────┬────────────┘    └────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│ Postgres│ │  Redis  │
│ PostGIS │ │ GEO+Pub │
└─────────┘ └─────────┘
```

**Monorepo** (Turborepo + pnpm workspaces) with 4 packages:

| Package | Role |
|---------|------|
| `api-gateway` | REST API + WebSocket server |
| `ride-worker` | Background job processing (BullMQ) |
| `common` | Shared Prisma schema, Zod schemas, constants |
| `notifications` | Socket.io Redis adapter for cross-process events |

---

## Key Engineering Decisions

### 🗺️ Why Redis GEO over SQL for driver lookup?
`GEOSEARCH` returns drivers sorted by distance in **O(log N + M)** — orders of magnitude faster than a PostGIS query scanning the drivers table. Drivers update their position every few seconds; Redis handles this write-heavy workload without touching the database.

### 🔒 Why SETNX for ride acceptance?
Two drivers could accept the same ride simultaneously. `SETNX` (set-if-not-exists) acts as a **distributed lock** — the first driver wins atomically, the second gets a clean rejection. No database race conditions.

### ⚡ Why BullMQ instead of direct processing?
Ride matching involves multiple network calls (Redis lookup → filter → DB write → WebSocket emit → schedule timeout). If any step fails, BullMQ **retries automatically**. The cascade timeout (30s per driver) uses BullMQ's delayed jobs — no cron needed.

### 🚦 Why throttle location updates?
A driver's phone sends GPS every ~1 second. Without throttling, that's 60 PostGIS queries + 60 WebSocket broadcasts per minute per active ride. The **SETNX 3-second throttle** cuts this to 20/minute while still updating Redis GEO position on every tick.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | TypeScript | End-to-end type safety across all packages |
| API | Express.js | Lightweight, middleware-driven |
| Realtime | Socket.io + Redis Adapter | Cross-process WebSocket events |
| Database | PostgreSQL + PostGIS | Geospatial queries (distance, points) |
| ORM | Prisma | Type-safe DB access + migrations |
| Cache/Geo | Redis | GEO commands, pub/sub, distributed locks |
| Queue | BullMQ | Reliable job processing with retries |
| Validation | Zod | Runtime schema validation |
| Auth | JWT + bcrypt | Stateless authentication |
| Monorepo | Turborepo + pnpm | Shared packages, parallel builds |
| Testing | Vitest | Fast unit tests (76 passing) |
| Infra | Docker Compose | One-command dev environment |

---

## API Highlights

<details>
<summary><b>Authentication</b></summary>

- `POST /auth/register` — rider or driver registration
- `POST /auth/login` — JWT token issuance
- `GET /user/profile` — authenticated user profile
</details>

<details>
<summary><b>Ride Lifecycle</b></summary>

- `POST /rides/create` — request a ride (triggers matching)
- `POST /rides/:tripId/accept` — driver accepts (SETNX lock)
- `POST /rides/:tripId/verify-otp` — OTP verification at pickup
- `POST /rides/:tripId/complete` — complete ride (fare calculation)
- `PATCH /rides/cancel` — cancel ride
</details>

<details>
<summary><b>Dashboard</b></summary>

- `GET /rides/history` — paginated ride history
- `GET /rides/:tripId` — ride details
- `GET /user/driver/stats` — total rides, earnings, distance
- `GET /user/driver/current-ride` — active ride + rider info
- `GET /user/rider/current-ride` — active ride + driver location
</details>

<details>
<summary><b>WebSocket Events</b></summary>

- `ride:offer` → driver receives ride offer
- `ride:accepted` → rider notified of match
- `ride:otp` → rider receives pickup OTP
- `ride:driver-location` → live tracking with ETA
- `ride:completed` → fare breakdown
</details>

---

## Quick Start

```bash
# Clone and start infrastructure
git clone https://github.com/codeRisshi25/urbanpulse-backend.git
cd urbanpulse-backend
cp .env.example .env

# Start PostgreSQL + Redis
docker compose up -d

# Install and run
pnpm install
pnpm run dev
```

---

## Testing

```bash
pnpm test          # 76 tests across all packages
pnpm typecheck     # TypeScript validation
```

A Postman collection (`UrbanPulse_Postman_Collection.json`) is included for manual API testing.

---

<div align="center">
<sub>Built as a systems design exercise in distributed real-time architectures.</sub>
</div>
