import app from "./logger.js";
import { logger } from "./logger.js";
import redis from "@fastify/redis";

app.register(redis, {
  host: process.env.REDIS_HOST || "redis",
  port: Number(process.env.REDIS_PORT) || 6379,
  closeClient: true
});

app.get("/", async (req, res) => {
  return { success: "1000" };
});

app.listen({ port: 3000 }, async (err, address) => {
  if (err) throw err;

  try {
    const pong = await app.redis.ping();
    console.log("Redis ping:", pong);    
  } catch (err) {
    console.error("Redis connection error:", err);
  }
  console.log(`Server listening on ${address}`);
  logger.info(`Server listening on ${address}`);
});
