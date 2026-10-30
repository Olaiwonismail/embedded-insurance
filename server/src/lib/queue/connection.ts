import IORedis, { Redis } from 'ioredis';

export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

export function redisUrl(): string {
  return process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

// Namespaces every queue key, so one Redis can carry more than one environment.
export function queuePrefix(): string {
  return process.env.REDIS_PREFIX ?? 'bull';
}

// BullMQ needs retries left on, so maxRetriesPerRequest must be null.
export function createRedis(url: string = redisUrl()): Redis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}
