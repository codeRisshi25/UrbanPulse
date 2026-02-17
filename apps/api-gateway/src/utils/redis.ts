import { Redis } from 'ioredis';
import logger from '../logger.js';

declare global {
  var redis: Redis | undefined;
}

const createRedisClient = (): Redis => {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    retryStrategy(times: number) {
      const delay = Math.min(times * 100, 3000);
      logger.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('connect', () => {
    logger.info('Redis connected');
  });

  client.on('error', (err: Error) => {
    logger.error({ err }, 'Redis error');
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return client;
};

const redis: Redis = global.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  global.redis = redis;
}

export default redis;
