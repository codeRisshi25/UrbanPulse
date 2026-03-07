/** Fare calculation constants. */

/** Base fare in currency units. */
export const BASE_FARE = 50;

/** Rate per kilometer. */
export const PER_KM_RATE = 12;

/** Minimum fare (never below base fare). */
export const MIN_FARE = 50;

/** Average city speed in km/h for ETA estimation. */
export const CITY_AVG_SPEED_KMH = 30;

/** Throttle interval for driver location updates (seconds). */
export const LOCATION_THROTTLE_SECONDS = 3;

/** Redis key prefix for location throttle — full key: `driver:location-throttle:{userId}` */
export const LOCATION_THROTTLE_KEY_PREFIX = 'driver:location-throttle:';
