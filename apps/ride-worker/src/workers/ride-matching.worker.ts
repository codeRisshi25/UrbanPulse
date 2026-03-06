import { Worker, Job } from 'bullmq';
import logger from '../logger.js';
import { QUEUE_NAMES, REDIS_CONFIG } from '../config.js';
import { runCascadeMatching, handleOfferTimeout, type CascadeContext } from '../matching/index.js';

export interface RideMatchingJobData extends CascadeContext {
  offerId?: string;
}

/**
 * Process ride-matching jobs:
 * - 'match-driver': Initial cascade from ride-request worker
 * - 'cascade-expanded' / 'cascade-skip': Continued cascade
 * - 'offer-timeout': Delayed job checking if an offer expired
 */
const processRideMatching = async (job: Job<RideMatchingJobData>) => {
  const { tripId, attempt = 1 } = job.data;

  logger.info(
    { tripId, jobName: job.name, attempt, jobId: job.id },
    'ride-matching job received',
  );

  if (job.name === 'offer-timeout' && job.data.offerId) {
    // Handle timeout for a specific offer
    await handleOfferTimeout(job.data.offerId, {
      tripId: job.data.tripId,
      riderId: job.data.riderId,
      pickupLng: job.data.pickupLng,
      pickupLat: job.data.pickupLat,
      dropoffLng: job.data.dropoffLng,
      dropoffLat: job.data.dropoffLat,
      attempt: job.data.attempt ?? attempt,
      skippedDriverIds: job.data.skippedDriverIds,
    });
  } else {
    // Run cascade matching (initial or continued)
    await runCascadeMatching({
      tripId: job.data.tripId,
      riderId: job.data.riderId,
      pickupLng: job.data.pickupLng,
      pickupLat: job.data.pickupLat,
      dropoffLng: job.data.dropoffLng,
      dropoffLat: job.data.dropoffLat,
      attempt: job.data.attempt ?? attempt,
      skippedDriverIds: job.data.skippedDriverIds,
    });
  }
};

export const createRideMatchingWorker = () => {
  const worker = new Worker<RideMatchingJobData>(QUEUE_NAMES.RIDE_MATCHING, processRideMatching, {
    connection: REDIS_CONFIG,
    concurrency: 10,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tripId: job.data.tripId }, 'ride-matching job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-matching job failed');
  });

  return worker;
};
