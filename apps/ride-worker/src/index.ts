import 'dotenv/config';
import logger from './logger.js';
import { createRideRequestWorker } from './workers/ride-request.worker.js';
import { createRideMatchingWorker } from './workers/ride-matching.worker.js';
import { createRideLifecycleWorker } from './workers/ride-lifecycle.worker.js';
import redis from './utils/redis.js';

const workers = [
  createRideRequestWorker(),
  createRideMatchingWorker(),
  createRideLifecycleWorker(),
];

logger.info('ride-worker started — listening on all queues');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down ride-worker...');

  await Promise.all(workers.map((w) => w.close()));
  await redis.quit();

  logger.info('ride-worker shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
