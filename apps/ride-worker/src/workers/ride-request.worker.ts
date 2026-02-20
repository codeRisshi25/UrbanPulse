import { Worker, Job } from 'bullmq';
import { Queue } from 'bullmq';
import logger from '../logger.js';
import { QUEUE_NAMES } from '../config.js';

const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

export interface RideRequestJobData {
  tripId: string;
  riderId: string;
  pickupLng: number;
  pickupLat: number;
  dropoffLng: number;
  dropoffLat: number;
}

const rideMatchingQueue = new Queue(QUEUE_NAMES.RIDE_MATCHING, {
  connection: bullmqConnection,
});

const processRideRequest = async (job: Job<RideRequestJobData>) => {
  const { tripId, riderId, pickupLng, pickupLat } = job.data;

  logger.info(
    { tripId, riderId, pickupLng, pickupLat },
    'Processing ride request job',
  );

  // Publish a ride-matching job to initiate driver matching (fully implemented in M4)
  await rideMatchingQueue.add(
    'match-driver',
    { tripId, riderId, pickupLng, pickupLat },
    { jobId: `match:${tripId}` },
  );

  logger.info({ tripId }, 'Matching not yet implemented — ride-matching job queued (M4)');
};

export const createRideRequestWorker = () => {
  const worker = new Worker<RideRequestJobData>(
    QUEUE_NAMES.RIDE_REQUESTS,
    processRideRequest,
    {
      connection: bullmqConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tripId: job.data.tripId }, 'ride-request job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-request job failed');
  });

  return worker;
};
