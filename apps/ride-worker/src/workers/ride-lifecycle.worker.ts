import { Worker, Job } from 'bullmq';
import logger from '../logger.js';
import { QUEUE_NAMES } from '../config.js';

const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

export type RideLifecycleAction = 'ACCEPT' | 'VERIFY_OTP' | 'START' | 'COMPLETE' | 'CANCEL';

export interface RideLifecycleJobData {
  action: RideLifecycleAction;
  tripId: string;
  driverId?: string;
  riderId?: string;
  otp?: string;
}

// Skeleton processor — fully implemented in M4/M5
const processRideLifecycle = async (job: Job<RideLifecycleJobData>) => {
  const { action, tripId } = job.data;

  logger.info(
    { action, tripId },
    'ride-lifecycle job received — state transitions will be implemented in M4/M5',
  );

  switch (action) {
    case 'ACCEPT':
      logger.info({ tripId }, 'ACCEPT action — driver matching accept (M4)');
      break;
    case 'VERIFY_OTP':
      logger.info({ tripId }, 'VERIFY_OTP action — OTP verification (M4)');
      break;
    case 'START':
      logger.info({ tripId }, 'START action — ride start (M4)');
      break;
    case 'COMPLETE':
      logger.info({ tripId }, 'COMPLETE action — ride completion and fare calculation (M5)');
      break;
    case 'CANCEL':
      logger.info({ tripId }, 'CANCEL action — ride cancellation (M4)');
      break;
    default:
      logger.warn({ action, tripId }, 'Unknown ride lifecycle action');
  }
};

export const createRideLifecycleWorker = () => {
  const worker = new Worker<RideLifecycleJobData>(
    QUEUE_NAMES.RIDE_LIFECYCLE,
    processRideLifecycle,
    {
      connection: bullmqConnection,
      concurrency: 10,
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, action: job.data.action, tripId: job.data.tripId },
      'ride-lifecycle job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-lifecycle job failed');
  });

  return worker;
};
