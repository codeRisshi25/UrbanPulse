export const QUEUE_NAMES = {
  RIDE_REQUESTS: 'ride-requests',
  RIDE_MATCHING: 'ride-matching',
  RIDE_LIFECYCLE: 'ride-lifecycle',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
