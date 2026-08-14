import type { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => mockRedisInstance),
);

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    const config = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    } as unknown as ConfigService<never, true>;
    service = new CacheService(config);
  });

  describe('get/set/del', () => {
    it('returns undefined on a cache miss', async () => {
      mockRedisInstance.get.mockResolvedValue(null);
      await expect(service.get('k')).resolves.toBeUndefined();
    });

    it('returns the parsed value on a hit', async () => {
      mockRedisInstance.get.mockResolvedValue(JSON.stringify({ a: 1 }));
      await expect(service.get('k')).resolves.toEqual({ a: 1 });
    });

    it('writes with the given TTL', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');
      await service.set('k', { a: 1 }, 30);
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'k',
        JSON.stringify({ a: 1 }),
        'EX',
        30,
      );
    });

    it('deletes a key', async () => {
      mockRedisInstance.del.mockResolvedValue(1);
      await service.del('k');
      expect(mockRedisInstance.del).toHaveBeenCalledWith('k');
    });
  });

  // The whole point of this cache: it must never be the reason a request
  // fails. A Redis outage should read as "cache miss", not a 500 — this
  // is what makes the catalog/product-detail read paths degrade to
  // "slower", never "broken", when Redis is unavailable.
  describe('fails open on Redis errors', () => {
    it('get() returns undefined rather than throwing', async () => {
      mockRedisInstance.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.get('k')).resolves.toBeUndefined();
    });

    it('set() resolves rather than throwing', async () => {
      mockRedisInstance.set.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.set('k', 1, 30)).resolves.toBeUndefined();
    });

    it('del() resolves rather than throwing', async () => {
      mockRedisInstance.del.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.del('k')).resolves.toBeUndefined();
    });

    it('getVersion() falls back to 0 rather than throwing', async () => {
      mockRedisInstance.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.getVersion('catalog')).resolves.toBe(0);
    });

    it('bumpVersion() resolves rather than throwing', async () => {
      mockRedisInstance.incr.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.bumpVersion('catalog')).resolves.toBeUndefined();
    });
  });

  describe('versioned namespaces', () => {
    it('defaults to version 0 when unset', async () => {
      mockRedisInstance.get.mockResolvedValue(null);
      await expect(service.getVersion('catalog')).resolves.toBe(0);
    });

    it('reads back an already-bumped version', async () => {
      mockRedisInstance.get.mockResolvedValue('3');
      await expect(service.getVersion('catalog')).resolves.toBe(3);
    });

    it('increments the namespaced version key', async () => {
      await service.bumpVersion('catalog');
      expect(mockRedisInstance.incr).toHaveBeenCalledWith('catalog:version');
    });
  });
});
