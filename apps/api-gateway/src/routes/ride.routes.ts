import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { rideSchema } from 'common';
import { authenticate } from '../middleware/auth.js';
import { cancelRide, createRide } from '../services/ride.service.js';

const rideRouter: Router = Router();

rideRouter.post('/createRide', authenticate, validate(rideSchema), async (req, res) => {
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

rideRouter.patch('/cancelRide', authenticate, async (req, res) => {
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

export default rideRouter;
