import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { rideSchema, otpVerifySchema, rideCancelSchema, rideHistoryQuerySchema, tripIdParamSchema } from 'common';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  createRide,
  cancelRide,
  acceptRide,
  rejectRide,
  verifyOtp,
  driverCancelRide,
  completeRide,
  getRideHistory,
  getRideDetail,
} from '../services/ride.service.js';
import { getNearbyAvailableRides } from '../services/driver.service.js';

const rideRouter: Router = Router();

// ─── Rider endpoints ─────────────────────────────────────────────────────

rideRouter.post('/create', authenticate, validate(rideSchema), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const ride = await createRide(req.body, req.user.userId);
    if (!ride.success) return res.status(400).json(ride);
    return res.status(201).json(ride);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.patch('/cancel', authenticate, validate(rideCancelSchema), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { tripId } = req.body;
    const ride = await cancelRide(req.user.userId, tripId);
    if (!ride.success) return res.status(400).json(ride);
    return res.status(200).json(ride);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// ─── Ride history & detail ───────────────────────────────────────────────

rideRouter.get('/history', authenticate, validate(rideHistoryQuerySchema), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await getRideHistory(req.user.userId, req.user.role, page || 1, limit || 20);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.get('/:tripId', authenticate, validate(tripIdParamSchema), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await getRideDetail(req.user.userId, req.params.tripId);
    return res.status(result.success ? 200 : (result.message.includes('access') ? 403 : 400)).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// ─── Driver endpoints ────────────────────────────────────────────────────

rideRouter.get('/available', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await getNearbyAvailableRides(req.user.userId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.post('/:tripId/accept', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { offerId } = req.body;
    if (!offerId) return res.status(400).json({ success: false, message: 'offerId is required' });
    const result = await acceptRide(req.user.userId, req.params.tripId, offerId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.post('/:tripId/reject', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { offerId } = req.body;
    if (!offerId) return res.status(400).json({ success: false, message: 'offerId is required' });
    const result = await rejectRide(req.user.userId, req.params.tripId, offerId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.post('/:tripId/verify-otp', authenticate, authorize('driver'), validate(otpVerifySchema), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await verifyOtp(req.user.userId, req.params.tripId, req.body.otp);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.post('/:tripId/complete', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await completeRide(req.user.userId, req.params.tripId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

rideRouter.post('/:tripId/driver-cancel', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await driverCancelRide(req.user.userId, req.params.tripId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

export default rideRouter;
