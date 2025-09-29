import Fastify from "fastify";

// initializing the fasitfy app 
const app = Fastify({
  logger: {
    transport : {
      target: "@logtail/pino",
      options : {
        sourceToken: process.env.LOGGING_TOKEN,
        options: { endpoint: process.env.LOGGING_URL },
      }
    }
  }
});

export const logger = app.log // universal logger 
export default app;