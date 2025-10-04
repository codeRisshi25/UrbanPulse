import type { FastifyInstance, RouteGenericInterface } from 'fastify';

interface RegisterRoute extends RouteGenericInterface {
    Querystring: {
        username: string;
    };
}

export default async function (app: FastifyInstance, ops: any) {
    app.get<RegisterRoute>('/register', {}, async (request, reply) => {
        const username = request.query.username; 
        reply.code(201);
        return {
            "hello": username 
        };
    });
}