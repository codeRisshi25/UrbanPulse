import { z } from "zod";

export const initialRegistraionSchema = z.object({
    body: z.object({
        email : z.email({message : "A valid email is required"}),
        role : z.enum(['driver','rider'])
    })
})