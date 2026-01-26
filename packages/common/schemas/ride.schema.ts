import { z } from 'zod';

export const rideSchema = z.object({
  body: z.object({
    pickupLocation: z.array(z.number()).length(2, 'Pickup location must be an array of two float values [longitude, latitude]'),
    dropoffLocation: z.array(z.number()).length(2, 'Dropoff location must be an array of two float values [longitude, latitude]'),
  }),
});

export type RideInput = z.infer<typeof rideSchema>['body'];
