import { z } from 'zod';

export const initialRegistraionSchema = z.object({
  body: z.object({
    email: z.email({ message: 'A valid email is required' }),
    password: z.string(),
    role: z.enum(['d', 'r']),
  }),
});
