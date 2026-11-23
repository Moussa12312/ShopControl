import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getEnv } from '../config/env.config';

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;
  private readonly fallbackStore = new Map<string, MemoryEntry>();
  private connected = false;

  constructor() {
    const env = getEnv();
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 2000, 15_000),
    });

    this.client.on('ready', () => {
      this.connected = true;
    });
    this.client.on('close', () => {
      this.connected = false;
    });
    this.client.on('error', (err) => {
      this.connected = false;
      this.logger.warn(`Redis indisponible (${err.message})`);
    });
  }

  private canFallbackToMemory(): boolean {
    return true;
  }

  private readFallback(key: string): string | null {
    const entry = this.fallbackStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.fallbackStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    if (!this.connected) {
      return this.readFallback(key);
    }
    try {
      return await this.client.get(key);
    } catch {
      return this.readFallback(key);
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.fallbackStore.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
    if (this.connected) {
      try {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
      } catch {
        // Fallback store is already populated
      }
    }
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const fallbackCurrent = Number(this.readFallback(key) || '0') + 1;
    this.fallbackStore.set(key, {
      value: String(fallbackCurrent),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    if (!this.connected) {
      return fallbackCurrent;
    }
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch {
      return fallbackCurrent;
    }
  }

  async del(key: string): Promise<void> {
    this.fallbackStore.delete(key);
    if (!this.connected) return;
    try {
      await this.client.del(key);
    } catch {
      // Ignored
    }
  }

  async ping(): Promise<string> {
    if (!this.connected) {
      return this.canFallbackToMemory() ? 'FALLBACK_MEMORY' : 'DOWN';
    }
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
