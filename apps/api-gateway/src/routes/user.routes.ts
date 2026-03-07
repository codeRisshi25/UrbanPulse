import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getUserProfile } from '../services/auth.service.js';
import { setDriverOnline, setDriverOffline, updateDriverLocation } from '../services/driver.service.js';
import { getDriverStats, getDriverCurrentRide, getRiderCurrentRide } from '../services/ride.service.js';
import { driverStatusSchema, driverLocationSchema } from 'common';
import logger from '../logger.js';

const userRouter: Router = Router();

/**
 * @route   GET /user/profile
 * @desc    Get user profile
 * @access  Private
 */
userRouter.get('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const profile = await getUserProfile(req.user.userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: profile,
    });
  } catch (error) {
    logger.error(error, 'Error fetching profile');
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * @route   GET /user/me
 * @desc    Get current authenticated user info
 * @access  Private
 */
userRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User info retrieved successfully',
      data: {
        userId: req.user.userId,
        number: req.user.number,
        role: req.user.role,
      },
    });
  } catch (error) {
    logger.error(error, 'Error fetching user info');
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   PATCH /user/driver/status
 * @desc    Toggle driver online/offline
 * @access  Private (driver only)
 */
userRouter.patch(
  '/driver/status',
  authenticate,
  authorize('driver'),
  validate(driverStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { isActive, location } = req.body as { isActive: boolean; location?: [number, number] };
      const userId = req.user!.userId;

      const result = isActive
        ? await setDriverOnline(userId, location!)
        : await setDriverOffline(userId);

      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logger.error(error, 'Error updating driver status');
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

/**
 * @route   POST /user/driver/location
 * @desc    Update driver's current location
 * @access  Private (driver only)
 */
userRouter.post(
  '/driver/location',
  authenticate,
  authorize('driver'),
  validate(driverLocationSchema),
  async (req: Request, res: Response) => {
    try {
      const { location } = req.body as { location: [number, number] };
      const result = await updateDriverLocation(req.user!.userId, location);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logger.error(error, 'Error updating driver location');
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

/**
 * @route   GET /user/driver/stats
 * @desc    Driver statistics (total rides, earnings, distance)
 * @access  Private (driver only)
 */
userRouter.get('/driver/stats', authenticate, authorize('driver'), async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await getDriverStats(req.user.userId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error(error, 'Error fetching driver stats');
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

/**
 * @route   GET /user/driver/current-ride
 * @desc    Driver's current active ride (ACCEPTED or STARTED)
 * @access  Private (driver only)
 */
userRouter.get('/driver/current-ride', authenticate, authorize('driver'), async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await getDriverCurrentRide(req.user.userId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error(error, 'Error fetching driver current ride');
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

/**
 * @route   GET /user/rider/current-ride
 * @desc    Rider's current active ride (REQUESTED, ACCEPTED, or STARTED)
 * @access  Private
 */
userRouter.get('/rider/current-ride', authenticate, authorize('rider'), async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await getRiderCurrentRide(req.user.userId);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error(error, 'Error fetching rider current ride');
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
});

export default userRouter;
