import { Router } from 'express';
import authRouter from './routes/auth.routes.js';
import userRouter from './routes/user.routes.js';
import rideRouter from './routes/ride.routes.js';
import redis from './utils/redis.js';

const router: Router = Router();

// Health check route
router.get('/health', async (req, res) => {
  let redisStatus = 'ok';
  try {
    await redis.ping();
  } catch {
    redisStatus = 'error';
  }

  res.status(200).json({
    success: true,
    message: 'API Gateway is running',
    timestamp: new Date().toISOString(),
    services: {
      api: 'ok',
      redis: redisStatus,
    },
  });
});

// Auth routes
router.use('/auth', authRouter);
// User routes
router.use('/user', userRouter);
// Ride routes
router.use('/rides', rideRouter);

// 404 handler
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

export default router;
