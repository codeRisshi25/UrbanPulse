import { Router, Request, Response } from 'express';
import { registrationSchema, loginSchema } from 'common';
import { validate } from '../middleware/validate.js';
import { registerUser, loginUser } from '../services/auth.service.js';
import logger from '../logger.js';

const authRouter: Router = Router();

/**
 * @route   POST /auth/register
 * @desc    Register a new user (driver or rider)
 * @access  Public
 */
authRouter.post('/register', validate(registrationSchema), async (req: Request, res: Response) => {
  try {
    const result = await registerUser(req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);
  } catch (error) {
    logger.error(error, 'Registration endpoint error');
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * @route   POST /auth/login
 * @desc    Login an existing user
 * @access  Public
 */
authRouter.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const result = await loginUser(req.body);

    if (!result.success) {
      return res.status(401).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error(error, 'Login endpoint error');
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

export default authRouter;
