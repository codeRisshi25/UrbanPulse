import { Router } from 'express';
import authRouter from './routes/auth.routes.js';
import userRouter from './routes/user.routes.js';
import logger from './logger.js';

const router: Router = Router();

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Gateway is running',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes
router.use('/auth', authRouter);
// User routes
router.use('/user', userRouter);

// 404 handler
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

export default router;
