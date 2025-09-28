import Fastify from "fastify";
const token = process.env.LOGGING_TOKEN;

const app = Fastify({
  logger: {
    transport : {
      target: "@logtail/pino",
      options : {
        sourceToken: token,
        options: { endpoint: process.env.LOGGING_URL },
      }
    }
  }
});


app.get("/", async function handler(req, res) {
  return { success: "1000" };
});

app.listen({ port: 3000 , host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err)
      process.exit(1);
    }
    app.log.info(`Server listening at ${address}`);
});