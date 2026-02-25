import 'dotenv/config';
import logger from './logger.js';
import { createRideRequestWorker } from './workers/ride-request.worker.js';
import { createRideMatchingWorker } from './workers/ride-matching.worker.js';
import { createRideLifecycleWorker } from './workers/ride-lifecycle.worker.js';
import redis from './utils/redis.js';

const rideRequestResult = createRideRequestWorker();
const workers = [
  rideRequestResult.worker,
  createRideMatchingWorker(),
  createRideLifecycleWorker(),
];

// Queues created inside workers that must be closed on shutdown
const workerQueues = [rideRequestResult.queue];

logger.info('ride-worker started — listening on all queues');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down ride-worker...');

  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(workerQueues.map((q) => q.close()));
    await redis.quit();

    logger.info('ride-worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err, signal }, 'Error during ride-worker shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
