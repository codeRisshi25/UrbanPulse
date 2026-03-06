import logger from './logger.js';

type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';

/**
 * Valid ride status transitions.
 *
 *   REQUESTED → ACCEPTED  (driver accepts offer)
 *   REQUESTED → CANCELLED (rider cancels, or no drivers found)
 *   ACCEPTED  → STARTED   (OTP verified at pickup)
 *   ACCEPTED  → CANCELLED (rider or driver cancels)
 *   STARTED   → COMPLETED (driver ends ride — M5)
 */
const VALID_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
    REQUESTED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['STARTED', 'CANCELLED'],
    STARTED: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
};

/**
 * Validate whether a status transition is allowed.
 * Throws if the transition is invalid.
 */
export const validateTransition = (from: RideStatus, to: RideStatus): void => {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
        const msg = `Invalid ride transition: ${from} → ${to}`;
        logger.warn({ from, to }, msg);
        throw new Error(msg);
    }
};

/**
 * Check if a transition is valid without throwing.
 */
export const isValidTransition = (from: RideStatus, to: RideStatus): boolean => {
    const allowed = VALID_TRANSITIONS[from];
    return !!allowed && allowed.includes(to);
};

export type { RideStatus };
