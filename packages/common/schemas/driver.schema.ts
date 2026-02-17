import { z } from 'zod';

const locationTuple = z.tuple([z.number(), z.number()]).describe('[longitude, latitude]');

export const driverStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
    location: locationTuple.optional(),
  }).refine(
    (data) => !data.isActive || data.location !== undefined,
    { message: 'location is required when going online', path: ['location'] }
  ),
});

export type DriverStatusInput = z.infer<typeof driverStatusSchema>['body'];

export const driverLocationSchema = z.object({
  body: z.object({
    location: locationTuple,
  }),
});

export type DriverLocationInput = z.infer<typeof driverLocationSchema>['body'];
