/** All Socket.io event name constants used across api-gateway and ride-worker. */
export const SOCKET_EVENTS = {
    /** Emitted to a driver's personal room when a new ride offer is available. */
    RIDE_OFFER: 'ride:offer',
    /** Emitted to a driver's personal room when the ride offer has expired. */
    RIDE_OFFER_EXPIRED: 'ride:offer-expired',
    /** Emitted to a rider's personal room when a driver accepts their ride. */
    RIDE_ACCEPTED: 'ride:accepted',
    /** Emitted to the ride room when the driver has started the trip. */
    RIDE_STARTED: 'ride:started',
    /** Emitted to the ride room when the trip is complete. */
    RIDE_COMPLETED: 'ride:completed',
    /** Emitted to the ride room when either party cancels the trip. */
    RIDE_CANCELLED: 'ride:cancelled',
    /** Continuous driver location stream emitted to the `ride:{tripId}` room. */
    DRIVER_LOCATION: 'ride:driver-location',
    /** OTP emitted to the rider when driver reaches pickup (M4/M5). */
    OTP_GENERATED: 'ride:otp',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
