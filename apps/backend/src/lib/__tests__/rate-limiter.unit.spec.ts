import { RateLimiter } from '../rate-limiter';
import { redisManager } from '../redis';

type CounterValue = {
  value: number;
  expiresAt: number | null;
};

const mockCounters = new Map<string, CounterValue>();

const purgeExpired = (key?: string) => {
  const now = Date.now();

  if (key) {
    const entry = mockCounters.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now) {
      mockCounters.delete(key);
    }
    return;
  }

  for (const [k, entry] of mockCounters.entries()) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      mockCounters.delete(k);
    }
  }
};

const mockRedisClient = {
  async get(key: string) {
    purgeExpired(key);
    const entry = mockCounters.get(key);
    return entry ? String(entry.value) : null;
  },

  async incr(key: string) {
    purgeExpired(key);
    const entry = mockCounters.get(key);

    if (entry) {
      entry.value += 1;
      return entry.value;
    }

    mockCounters.set(key, { value: 1, expiresAt: null });
    return 1;
  },

  async expire(key: string, seconds: number, mode?: 'NX') {
    purgeExpired(key);
    const entry = mockCounters.get(key);

    if (!entry) {
      return 0;
    }

    if (mode === 'NX' && entry.expiresAt !== null) {
      return 0;
    }

    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  },

  async del(keys: string | string[]) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    let removed = 0;

    for (const key of keyList) {
      if (mockCounters.delete(key)) {
        removed += 1;
      }
    }

    return removed;
  },

  async quit() {
    return 'OK';
  },
};

jest.mock('../redis', () => ({
  redisManager: {
    getClient: jest.fn(async () => mockRedisClient),
    disconnect: jest.fn(async () => undefined),
  },
}));

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  const testConfig = {
    windowMs: 10000,
    maxRequests: 3,
    keyPrefix: 'test',
  };

  beforeEach(() => {
    mockCounters.clear();
    rateLimiter = new RateLimiter(testConfig);
  });

  describe('checkLimit - basic functionality', () => {
    it('should allow requests under the limit', async () => {
      const identifier = 'user1';

      const result1 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      const result2 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      const result3 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    it('should block requests over the limit', async () => {
      const identifier = 'user2';

      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }

      const result = await rateLimiter.checkLimit(identifier);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(result.retryAfter).toBeLessThanOrEqual(10);
      }
    });

    it('should return correct retry-after time', async () => {
      const identifier = 'user3';

      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }

      const result = await rateLimiter.checkLimit(identifier);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(result.retryAfter).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('incrementCounter', () => {
    it('should increment the counter correctly', async () => {
      const identifier = 'user4';

      const result1 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      const result2 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    it('should handle multiple increments correctly', async () => {
      const identifier = 'user5';

      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter.checkLimit(identifier);
        expect(result.allowed).toBe(true);
        await rateLimiter.incrementCounter(identifier);
      }

      const finalResult = await rateLimiter.checkLimit(identifier);
      expect(finalResult.allowed).toBe(false);
    });
  });

  describe('resetCounter', () => {
    it('should reset the counter to zero', async () => {
      const identifier = 'user6';

      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }

      const blockedResult = await rateLimiter.checkLimit(identifier);
      expect(blockedResult.allowed).toBe(false);

      await rateLimiter.resetCounter(identifier);

      const result = await rateLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    });

    it('should only reset the specific identifier', async () => {
      const user1 = 'user7';
      const user2 = 'user8';

      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(user1);
        await rateLimiter.incrementCounter(user1);

        await rateLimiter.checkLimit(user2);
        await rateLimiter.incrementCounter(user2);
      }

      await rateLimiter.resetCounter(user1);

      const result1 = await rateLimiter.checkLimit(user1);
      const result2 = await rateLimiter.checkLimit(user2);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(false);
    });
  });

  describe('multiple identifiers', () => {
    it('should track different identifiers independently', async () => {
      const user1 = 'user9';
      const user2 = 'user10';
      const user3 = 'user11';

      for (let i = 0; i < 2; i++) {
        await rateLimiter.checkLimit(user1);
        await rateLimiter.incrementCounter(user1);

        await rateLimiter.checkLimit(user2);
        await rateLimiter.incrementCounter(user2);

        await rateLimiter.checkLimit(user3);
        await rateLimiter.incrementCounter(user3);
      }

      const result1 = await rateLimiter.checkLimit(user1);
      const result2 = await rateLimiter.checkLimit(user2);
      const result3 = await rateLimiter.checkLimit(user3);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });
  });

  describe('sliding window behavior', () => {
    it('should allow requests after window expires', async () => {
      const shortLimiter = new RateLimiter({
        windowMs: 1000,
        maxRequests: 2,
        keyPrefix: 'test-short',
      });

      const identifier = 'user12';

      await shortLimiter.checkLimit(identifier);
      await shortLimiter.incrementCounter(identifier);

      await shortLimiter.checkLimit(identifier);
      await shortLimiter.incrementCounter(identifier);

      const blockedResult = await shortLimiter.checkLimit(identifier);
      expect(blockedResult.allowed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const result = await shortLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    }, 10000);
  });

  describe('concurrent requests', () => {
    it('should handle concurrent requests correctly', async () => {
      const identifier = 'user13';

      const promises = Array.from({ length: 5 }, async () => {
        const result = await rateLimiter.checkLimit(identifier);
        if (result.allowed) {
          await rateLimiter.incrementCounter(identifier);
        }
        return result;
      });

      const results = await Promise.all(promises);

      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBeGreaterThanOrEqual(3);
      expect(allowedCount).toBeLessThanOrEqual(5);
      expect(blockedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty identifier', async () => {
      const result = await rateLimiter.checkLimit('');
      expect(result.allowed).toBe(true);
    });

    it('should handle special characters in identifier', async () => {
      const identifier = 'user@example.com:192.168.1.1';
      const result = await rateLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    });

    it('should handle very long identifiers', async () => {
      const identifier = 'a'.repeat(1000);
      const result = await rateLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should fail open when redis is unavailable', async () => {
      const getClientMock = redisManager.getClient as jest.Mock;
      getClientMock.mockRejectedValueOnce(new Error('Redis unavailable'));

      const localLimiter = new RateLimiter(testConfig);
      const result = await localLimiter.checkLimit('user-error');
      expect(result.allowed).toBe(true);
    });
  });
});
