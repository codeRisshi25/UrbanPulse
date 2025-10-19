import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUserProfile } from '../services/auth.service.js';
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

export default userRouter;
