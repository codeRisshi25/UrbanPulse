import { z } from 'zod';

const longitudeSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);
const locationTuple = z.tuple([longitudeSchema, latitudeSchema]).describe('[longitude, latitude]');

export const driverStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
    // location is required when going online; accepted but ignored when going offline
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
