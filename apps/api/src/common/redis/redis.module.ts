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
    return getEnv().NODE_ENV !== 'production';
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
    if (!this.connected && this.canFallbackToMemory()) {
      return this.readFallback(key);
    }
    try {
      return await this.client.get(key);
    } catch (err) {
      if (this.canFallbackToMemory()) return this.readFallback(key);
      throw err;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.connected && this.canFallbackToMemory()) {
      this.fallbackStore.set(key, {
        value,
        expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
      return;
    }
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      if (this.canFallbackToMemory()) {
        this.fallbackStore.set(key, {
          value,
          expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
        });
        return;
      }
      throw err;
    }
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (!this.connected && this.canFallbackToMemory()) {
      const current = Number(this.readFallback(key) || '0') + 1;
      await this.set(key, String(current), ttlSeconds);
      return current;
    }
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch (err) {
      if (this.canFallbackToMemory()) {
        const current = Number(this.readFallback(key) || '0') + 1;
        this.fallbackStore.set(key, {
          value: String(current),
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
        return current;
      }
      throw err;
    }
  }

  async del(key: string): Promise<void> {
    this.fallbackStore.delete(key);
    if (!this.connected && this.canFallbackToMemory()) return;
    try {
      await this.client.del(key);
    } catch (err) {
      if (!this.canFallbackToMemory()) throw err;
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
