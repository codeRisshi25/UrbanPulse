import { z } from 'zod';

/** Schema for OTP verification request body. */
export const otpVerifySchema = z.object({
    body: z.object({
        otp: z.string().length(4, 'OTP must be exactly 4 digits').regex(/^\d{4}$/, 'OTP must be numeric'),
    }),
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>['body'];

/** Schema for enhanced ride cancellation with explicit tripId. */
export const rideCancelSchema = z.object({
    body: z.object({
        tripId: z.string().uuid('tripId must be a valid UUID'),
    }),
});

export type RideCancelInput = z.infer<typeof rideCancelSchema>['body'];
