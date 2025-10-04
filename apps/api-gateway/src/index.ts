import app from './logger.js';
import { logger } from './logger.js';
import redis from '@fastify/redis';
import userRoutes from './routes/user.routes.js';

// register a redis client
app.register(redis, {
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
  closeClient: true,
});

// register routes
app.register(userRoutes, { prefix: '/api' });

app.get('/', async (req, res) => {
  return { success: '1000' };
});

const start = async () => {
  try {
    const address = await app.listen({ port: 3000, host: '0.0.0.0' });
    logger.info(`Server listening on ${address}`);
    const pong = await app.redis.ping();
    logger.info(`Redis ping: ${pong}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
