import Fastify from "fastify";

const app = Fastify({
  logger: true,
});

app.get("/", async function handler(req, res) {
  return { success: "200" };
});

app.listen({ port: 8080 }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});