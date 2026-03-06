/** Cascade matching algorithm constants. */

/** Initial search radius in km for finding nearby drivers. */
export const MATCHING_RADIUS_KM = 5;

/** Expanded radius in km (fallback after initial radius exhausted). */
export const MATCHING_EXPANDED_RADIUS_KM = 10;

/** Seconds to wait for a driver to accept before cascading to the next. */
export const OFFER_TIMEOUT_SECONDS = 30;

/** Maximum number of drivers to offer a ride to before cancelling. */
export const MAX_CASCADE_ATTEMPTS = 10;

/** Redis key for the set of busy (on-ride) driver IDs. */
export const DRIVERS_BUSY_KEY = 'drivers:busy';

/** Redis key for the GEO set of active driver positions. */
export const DRIVERS_GEO_KEY = 'drivers:active';

/** Redis key prefix for OTPs — full key: `otp:{tripId}` */
export const OTP_KEY_PREFIX = 'otp:';

/** Redis key prefix for OTP attempt counters — full key: `otp:attempts:{tripId}` */
export const OTP_ATTEMPTS_KEY_PREFIX = 'otp:attempts:';

/** Maximum OTP verification attempts before cancellation. */
export const MAX_OTP_ATTEMPTS = 3;

/** OTP TTL in seconds (15 minutes). */
export const OTP_TTL_SECONDS = 15 * 60;

/** Redis key prefix for distributed ride lock — full key: `ride:lock:{tripId}` */
export const RIDE_LOCK_KEY_PREFIX = 'ride:lock:';
