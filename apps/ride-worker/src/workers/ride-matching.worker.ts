import { Worker, Job } from 'bullmq';
import logger from '../logger.js';
import { QUEUE_NAMES } from '../config.js';

const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

export interface RideMatchingJobData {
  tripId: string;
  riderId: string;
  pickupLng: number;
  pickupLat: number;
  attempt?: number;
}

// Skeleton processor — fully implemented in M4 (nearest-first cascade)
const processRideMatching = async (job: Job<RideMatchingJobData>) => {
  const { tripId, riderId, attempt = 1 } = job.data;

  logger.info(
    { tripId, riderId, attempt },
    'ride-matching job received — matching algorithm will be implemented in M4',
  );
};

export const createRideMatchingWorker = () => {
  const worker = new Worker<RideMatchingJobData>(
    QUEUE_NAMES.RIDE_MATCHING,
    processRideMatching,
    {
      connection: bullmqConnection,
      concurrency: 10,
      // Support for delayed jobs needed for matching timeout cascade (M4)
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tripId: job.data.tripId }, 'ride-matching job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-matching job failed');
  });

  return worker;
};
