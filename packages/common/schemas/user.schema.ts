import { z } from 'zod';

// Registration schema
export const registrationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be less than 100 characters'),
    number: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'A valid phone number is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must be less than 100 characters'),
    role: z.enum(['driver', 'rider'], {
      message: "Role must be either 'driver' or 'rider'",
    }),
  }),
});

// Login schema
export const loginSchema = z.object({
  body: z.object({
    number: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'A valid phone number is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

// Type exports for TypeScript
export type RegistrationInput = z.infer<typeof registrationSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
