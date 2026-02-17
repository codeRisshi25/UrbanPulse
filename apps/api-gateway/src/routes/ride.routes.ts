import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { rideSchema } from 'common';
import { authenticate, authorize } from '../middleware/auth.js';
import { cancelRide, createRide } from '../services/ride.service.js';
import { getNearbyAvailableRides } from '../services/driver.service.js';

const rideRouter: Router = Router();

rideRouter.post('/create', authenticate, validate(rideSchema), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const ride = await createRide(req.body, req.user.userId);
    if (!ride.success) {
      return res.status(400).json(ride);
    }
    return res.status(201).json(ride);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

rideRouter.patch('/cancel', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const ride = await cancelRide(req.user.userId);
    if (!ride.success) {
      return res.status(400).json(ride);
    }
    return res.status(200).json(ride);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

rideRouter.get('/available', authenticate, authorize('driver'), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }
    const result = await getNearbyAvailableRides(req.user.userId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

export default rideRouter;
