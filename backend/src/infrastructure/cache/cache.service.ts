import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../../config/configuration';

// A read-through cache for hot, publicly-cacheable reads (the product
// catalogue and individual product pages) — same posture as Meilisearch
// and the realtime layer (see .claude/rules/backend.md): never
// authoritative, and nothing on a write path (checkout, bidding, stock
// reservation) ever reads through here — those always hit Postgres
// directly inside their own transaction. A cache outage degrades to
// "slower", never to "wrong": every method below fails open — a Redis
// error is caught, logged, and treated as a cache miss/no-op rather than
// thrown, so ProductsService never has to know whether Redis is up.
//
// Its own connection, separate from QueueModule's — that one is
// dedicated to BullMQ's blocking semantics (maxRetriesPerRequest: null);
// this is a plain, fast-failing client for simple GET/SET/DEL/INCR.
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService<AppConfig, true>) {
    this.redis = new Redis(config.get('redis.url', { infer: true }), {
      maxRetriesPerRequest: 1,
      // Never let a mid-startup Redis blip fail app boot — HTTP traffic
      // must keep flowing (at DB-read speed) with the cache simply empty.
      lazyConnect: false,
    });
    this.redis.on('error', (err) => {
      this.logger.warn({ event: 'cache.redis_error', error: err });
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.logger.warn({ event: 'cache.get_failed', key, error: err });
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn({ event: 'cache.set_failed', key, error: err });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn({ event: 'cache.del_failed', key, error: err });
    }
  }

  // Versioned namespace: folding the current version into a cache key
  // gives instant invalidation of every previously cached variant (every
  // categoryId/sellerId/sort combination for the catalogue, for example)
  // without a Redis KEYS/SCAN sweep. Bumping the version just orphans the
  // old keys — they fall out of use immediately and expire off their own
  // TTL on their own schedule.
  async getVersion(namespace: string): Promise<number> {
    try {
      const raw = await this.redis.get(`${namespace}:version`);
      return raw ? Number(raw) : 0;
    } catch (err) {
      this.logger.warn({
        event: 'cache.get_version_failed',
        namespace,
        error: err,
      });
      return 0;
    }
  }

  async bumpVersion(namespace: string): Promise<void> {
    try {
      await this.redis.incr(`${namespace}:version`);
    } catch (err) {
      this.logger.warn({
        event: 'cache.bump_version_failed',
        namespace,
        error: err,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
