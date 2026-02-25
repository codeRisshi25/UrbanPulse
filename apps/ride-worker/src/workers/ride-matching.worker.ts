import { Worker, Job } from 'bullmq';
import logger from '../logger.js';
import { QUEUE_NAMES, REDIS_CONFIG } from '../config.js';

export interface RideMatchingJobData {
  tripId: string;
  riderId: string;
  pickupLng: number;
  pickupLat: number;
  dropoffLng: number;
  dropoffLat: number;
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
  const worker = new Worker<RideMatchingJobData>(QUEUE_NAMES.RIDE_MATCHING, processRideMatching, {
    connection: REDIS_CONFIG,
    concurrency: 10,
    // Support for delayed jobs needed for matching timeout cascade (M4)
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tripId: job.data.tripId }, 'ride-matching job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-matching job failed');
  });

  return worker;
};
