import { z } from 'zod';

const locationTuple = z.tuple([z.number(), z.number()]).describe('[longitude, latitude]');

export const rideSchema = z.object({
  body: z.object({
    pickupLocation: locationTuple.refine(
      ([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90,
      'Location must be valid coordinates [longitude, latitude]'
    ),
    dropoffLocation: locationTuple.refine(
      ([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90,
      'Location must be valid coordinates [longitude, latitude]'
    ),
  }),
});

export type RideInput = z.infer<typeof rideSchema>['body'];
