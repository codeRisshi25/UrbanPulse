import { createClient, type RedisClientType } from "redis"

let client: RedisClientType | undefined;

export async function connnectRedis (): Promise<RedisClientType>{
    if (!client) {
        client = createClient ({
            socket : {
                host : process.env.REDIS_HOST || "redis",
                port : Number (process.env.REDIS_PORT) || 6379 
            },
        });
        
        client.on("error" , (err) => {
            throw new Error("⚠️ Connection to redis failed !\n", err);
        })
        
        await client.connect();
    }
    return client;
}

export function getRedisClient() : RedisClientType {
    if (!client) throw new Error("Redis not connected yet homeboy ,Call the connectRedis func");
    return client;
}