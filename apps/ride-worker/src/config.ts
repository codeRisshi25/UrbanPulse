import { QUEUE_NAMES } from 'common';

export const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

export { QUEUE_NAMES };
