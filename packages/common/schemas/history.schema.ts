import { z } from 'zod';

/** Schema for ride history query params (pagination). */
export const rideHistoryQuerySchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
});

export type RideHistoryQuery = z.infer<typeof rideHistoryQuerySchema>['query'];

/** Schema for :tripId route param validation. */
export const tripIdParamSchema = z.object({
    params: z.object({
        tripId: z.string().uuid('tripId must be a valid UUID'),
    }),
});

export type TripIdParam = z.infer<typeof tripIdParamSchema>['params'];
