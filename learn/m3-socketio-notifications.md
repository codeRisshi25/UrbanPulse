# M3 — Socket.io Real-Time Layer & Notification Service

> **Branch:** `feature/m3-socketio-realtime` | **Closes:** Issue #8

---

## What is this milestone about?

M3 adds **real-time WebSocket communication** between clients (riders, drivers) and the server. It also creates a clean **notification abstraction layer** that lets any part of the system (api-gateway, ride-worker) emit events to clients without knowing the transport layer.

---

## Why WebSockets instead of REST polling?

REST is request-driven — the client must ask "did anything change?" repeatedly. WebSockets flip this: the server pushes events to clients the moment they happen. For a ride-sharing app, this is critical:

- Driver location updates happen every few seconds → polling would crush the server
- Ride status changes (accepted, started, completed) must feel instant to users
- Match offers must be delivered to drivers in real-time or they expire

---

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│              api-gateway (Express)            │
│                                               │
│  HTTP Server (http.createServer)              │
│      ├── Express REST routes  (same port!)    │
│      └── Socket.io server    (same port!)     │
│             ├── JWT auth middleware           │
│             ├── driver handlers               │
│             └── rider handlers                │
└──────────────────────────────────────────────┘
          │                    │
     Redis pub/sub         Redis GEO
          │
┌─────────────────────┐
│    ride-worker      │  ← publishes events via Redis adapter (M4+)
└─────────────────────┘
```

**Key insight:** Socket.io and Express share the **same HTTP server and port**. The Socket.io handshake is an HTTP Upgrade request — once upgraded to a WebSocket, it stays on a persistent connection.

---

## What changed in `index.ts`?

Before M3:
```ts
app.listen(PORT, () => { ... });   // Express owns the server
```

After M3:
```ts
const server = http.createServer(app);  // http owns the server
initSocketServer(server);               // Socket.io attaches to it
server.listen(PORT, () => { ... });     // same port, both protocols
```

---

## Files Created

| File | Purpose |
|------|---------|
| `packages/common/events/index.ts` | `SOCKET_EVENTS` constants shared across api-gateway and ride-worker |
| `packages/notifications/src/types/index.ts` | `NotificationChannel` interface definition |
| `packages/notifications/src/channels/socket.channel.ts` | `SocketChannel` — emits via Socket.io, supports Redis adapter |
| `packages/notifications/src/service.ts` | `NotificationService` class with `notifyDriver/Rider/Ride()` helpers |
| `packages/notifications/src/index.ts` | Main exports |
| `apps/api-gateway/src/sockets/index.ts` | Socket.io server init, Redis adapter, role-based handler routing |
| `apps/api-gateway/src/sockets/auth.ts` | JWT socket middleware |
| `apps/api-gateway/src/sockets/handlers/driver.ts` | Driver socket events |
| `apps/api-gateway/src/sockets/handlers/rider.ts` | Rider socket events |

---

## Socket Rooms Strategy

Socket.io has **rooms** — named channels you can broadcast to. Our strategy uses 3 types:

| Room | Members | Used for |
|------|---------|---------|
| `driver:{driverId}` | Only that driver | Ride offers, personal notifications |
| `rider:{riderId}` | Only that rider | Ride status updates, OTP |
| `ride:{tripId}` | Both assigned driver + rider | Location stream, shared status |

Every connection auto-joins its personal room. Riders join `ride:{tripId}` by emitting `rider:subscribe-driver-location`.

---

## Authentication Flow

Every WebSocket connection goes through a JWT check **before** connection is accepted:

```
Client → socket.connect({ auth: { token: "eyJ..." } })
         ↓
socketAuthMiddleware runs:
  1. Extract token from auth.token or Authorization header
  2. Call verifyToken() (same function REST uses)
  3. Attach decoded payload to socket.data.user
  4. Call next() → connection accepted
   OR
  4. Call next(Error) → connection rejected (client gets error event)
```

---

## Driver Events

| Client emits | Payload | Server does |
|---|---|---|
| `driver:go-online` | `{ lng, lat }` | DB update + Redis GEO add + heartbeat |
| `driver:go-offline` | — | DB update + Redis GEO remove |
| `driver:location-update` | `{ lng, lat }` | Redis GEO update (fast, no DB) |

> **Why no DB for location-update?** Location can change every few seconds. Writing to PostgreSQL every second would be overwhelming. Redis GEO handles this in-memory at microsecond latency. The DB only needs to know `isActive: true/false`.

---

## Rider Events

| Client emits | Payload | Server does |
|---|---|---|
| `rider:subscribe-driver-location` | `{ tripId }` | Validates trip ownership, joins `ride:{tripId}` room |
| `rider:unsubscribe-driver-location` | `{ tripId }` | Leaves `ride:{tripId}` room |

**Ownership validation** is important: without it, any rider could subscribe to any trip's location stream (privacy violation).

---

## Notification Service — Why an Abstraction?

The `packages/notifications` package is a **channel pattern**:

```
NotificationService
  ├── SocketChannel   ← currently only this
  ├── SmsChannel      ← add later (Twilio)
  └── PushChannel     ← add later (FCM)
```

When you call `notifyDriver(driverId, SOCKET_EVENTS.RIDE_OFFER, data)`, it fans out to **all registered channels**. Adding SMS in the future means:
1. Create `SmsChannel implements NotificationChannel`
2. Pass it to `createNotificationService([socketChannel, smsChannel])`
3. No changes to calling code

---

## Redis Adapter — How Cross-Process Emission Works

```
ride-worker (no Socket.io)
    │
    │  publish to Redis pub/sub channel
    ↓
Redis
    │
    │  adapter subscribes and receives message
    ↓
api-gateway Socket.io server
    │
    │  io.to('driver:abc').emit('ride:offer', data)
    ↓
Client WebSocket
```

The ride-worker never has direct access to the WebSocket connections (those live in api-gateway). But by using the Redis adapter's pub/sub mechanism, any process can trigger emissions to any connected client.

---

## SOCKET_EVENTS Constants

```ts
SOCKET_EVENTS.RIDE_OFFER          // 'ride:offer'
SOCKET_EVENTS.RIDE_OFFER_EXPIRED  // 'ride:offer-expired'
SOCKET_EVENTS.RIDE_ACCEPTED       // 'ride:accepted'
SOCKET_EVENTS.RIDE_STARTED        // 'ride:started'
SOCKET_EVENTS.RIDE_COMPLETED      // 'ride:completed'
SOCKET_EVENTS.RIDE_CANCELLED      // 'ride:cancelled'
SOCKET_EVENTS.DRIVER_LOCATION     // 'ride:driver-location'
SOCKET_EVENTS.OTP_GENERATED       // 'ride:otp'
```

Using string constants prevents typos and gives intellisense. When M4 starts sending `RIDE_OFFER` events to drivers, it imports from `common/events` — no magic strings anywhere.

---

## How to Test Manually (when Docker is running)

```ts
// Client-side (pseudocode)
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3001', {
  transports: ['websocket'],
  auth: { token: '<JWT from POST /auth/login>' }
});

// Driver client
socket.emit('driver:go-online', { lng: 77.5946, lat: 12.9716 });

// Rider client — subscribe to live location during ride
socket.emit('rider:subscribe-driver-location', { tripId: '<uuid>' });
socket.on('ride:driver-location', (data) => {
  console.log('Driver at:', data);
});
```

---

## What comes next (M4)?

When a driver is matched to a ride, M4's ride-worker will:
```ts
const notifier = createNotificationService([new SocketChannel(io)]);
await notifier.notifyDriver(driverId, SOCKET_EVENTS.RIDE_OFFER, { tripId, ... });
```
The notification service + Redis adapter ensures this works even though the worker has no direct socket connections.
