import type { FastifyInstance } from 'fastify';
import { initialRegistraionSchema } from 'common/schemas/user.schema.js';
import {z} from "zod";

export default async function (app:FastifyInstance) {
    app.post('/register/basic', async function (request,reply){
        try {
            const requestBody = initialRegistraionSchema.parse(request).body;
            return reply.code(200).send({
                "success":requestBody.email
            })
        } catch (err) {
            if (err instanceof z.ZodError){
                return reply.status(300).send({
                    messagge:"Validation Failed",
                    error: err
                })
            }
            return reply.status(500).send({message: "Internal Server Error"})
        }
    })
}

