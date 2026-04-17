import { CSRFProtection, DEFAULT_CSRF_CONFIG } from '../csrf-protection';
import { redisManager } from '../redis';

type StoredValue = {
  value: string;
  expiresAt: number | null;
};

const mockStore = new Map<string, StoredValue>();

const purgeExpired = (key?: string) => {
  const now = Date.now();

  if (key) {
    const item = mockStore.get(key);
    if (item && item.expiresAt !== null && item.expiresAt <= now) {
      mockStore.delete(key);
    }
    return;
  }

  for (const [k, item] of mockStore.entries()) {
    if (item.expiresAt !== null && item.expiresAt <= now) {
      mockStore.delete(k);
    }
  }
};

const mockRedisClient = {
  async set(key: string, value: string, options?: { EX?: number }) {
    const expiresAt =
      options?.EX !== undefined ? Date.now() + options.EX * 1000 : null;
    mockStore.set(key, { value, expiresAt });
    return 'OK';
  },

  async get(key: string) {
    purgeExpired(key);
    return mockStore.get(key)?.value ?? null;
  },

  async exists(key: string) {
    purgeExpired(key);
    return mockStore.has(key) ? 1 : 0;
  },

  async del(keys: string | string[]) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    let removed = 0;

    for (const key of keyList) {
      if (mockStore.delete(key)) {
        removed += 1;
      }
    }

    return removed;
  },

  async ttl(key: string) {
    purgeExpired(key);
    const item = mockStore.get(key);

    if (!item) {
      return -2;
    }

    if (item.expiresAt === null) {
      return -1;
    }

    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      mockStore.delete(key);
      return -2;
    }

    return Math.ceil(remainingMs / 1000);
  },

  async keys(pattern: string) {
    purgeExpired();

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return Array.from(mockStore.keys()).filter((key) => key.startsWith(prefix));
    }

    return mockStore.has(pattern) ? [pattern] : [];
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

describe('CSRFProtection', () => {
  let csrf: CSRFProtection;

  beforeEach(async () => {
    csrf = new CSRFProtection();

    const redis = await redisManager.getClient();
    const keys = await redis.keys('csrf:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  });

  describe('Token Generation', () => {
    it('should generate a token successfully', async () => {
      const token = await csrf.generateToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate unique tokens', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 100 }, () => csrf.generateToken())
      );

      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    it('should generate tokens with correct format', async () => {
      const token = await csrf.generateToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBe(43);
    });

    it('should store token in Redis', async () => {
      const token = await csrf.generateToken();
      const exists = await csrf.tokenExists(token);

      expect(exists).toBe(true);
    });

    it('should set expiration on token', async () => {
      const token = await csrf.generateToken();
      const redis = await redisManager.getClient();
      const ttl = await redis.ttl(`csrf:${token}`);

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeGreaterThanOrEqual(3590);
      expect(ttl).toBeLessThanOrEqual(3600);
    });
  });

  describe('Token Validation', () => {
    it('should validate matching tokens', async () => {
      const token = await csrf.generateToken();
      const isValid = await csrf.validateToken(token, token);

      expect(isValid).toBe(true);
    });

    it('should reject mismatched tokens', async () => {
      const token1 = await csrf.generateToken();
      const token2 = await csrf.generateToken();
      const isValid = await csrf.validateToken(token1, token2);

      expect(isValid).toBe(false);
    });

    it('should reject missing cookie token', async () => {
      const token = await csrf.generateToken();
      const isValid = await csrf.validateToken(undefined, token);

      expect(isValid).toBe(false);
    });

    it('should reject missing header token', async () => {
      const token = await csrf.generateToken();
      const isValid = await csrf.validateToken(token, undefined);

      expect(isValid).toBe(false);
    });

    it('should reject empty tokens', async () => {
      const isValid1 = await csrf.validateToken('', '');
      expect(isValid1).toBe(false);

      const token = await csrf.generateToken();
      const isValid2 = await csrf.validateToken(token, '');
      expect(isValid2).toBe(false);

      const isValid3 = await csrf.validateToken('', token);
      expect(isValid3).toBe(false);
    });

    it('should reject non-existent tokens', async () => {
      const fakeToken = 'fake-token-that-does-not-exist-in-redis';
      const isValid = await csrf.validateToken(fakeToken, fakeToken);

      expect(isValid).toBe(false);
    });

    it('should reject tokens with different lengths', async () => {
      const token = await csrf.generateToken();
      const shortToken = token.substring(0, 10);
      const isValid = await csrf.validateToken(token, shortToken);

      expect(isValid).toBe(false);
    });
  });

  describe('Token Expiration', () => {
    it('should reject expired tokens', async () => {
      const shortLivedCsrf = new CSRFProtection({
        ...DEFAULT_CSRF_CONFIG,
        tokenExpiration: 1,
      });

      const token = await shortLivedCsrf.generateToken();
      const isValidBefore = await shortLivedCsrf.validateToken(token, token);

      expect(isValidBefore).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const isValidAfter = await shortLivedCsrf.validateToken(token, token);
      expect(isValidAfter).toBe(false);
    });

    it('should remove token from Redis after expiration', async () => {
      const shortLivedCsrf = new CSRFProtection({
        ...DEFAULT_CSRF_CONFIG,
        tokenExpiration: 1,
      });

      const token = await shortLivedCsrf.generateToken();
      const existsBefore = await shortLivedCsrf.tokenExists(token);
      expect(existsBefore).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const existsAfter = await shortLivedCsrf.tokenExists(token);
      expect(existsAfter).toBe(false);
    });
  });

  describe('Token Invalidation', () => {
    it('should invalidate token', async () => {
      const token = await csrf.generateToken();
      const isValidBefore = await csrf.validateToken(token, token);

      expect(isValidBefore).toBe(true);

      await csrf.invalidateToken(token);

      const isValidAfter = await csrf.validateToken(token, token);
      expect(isValidAfter).toBe(false);
    });

    it('should remove token from Redis on invalidation', async () => {
      const token = await csrf.generateToken();
      const existsBefore = await csrf.tokenExists(token);

      expect(existsBefore).toBe(true);

      await csrf.invalidateToken(token);

      const existsAfter = await csrf.tokenExists(token);
      expect(existsAfter).toBe(false);
    });
  });

  describe('Security Properties', () => {
    it('should consistently reject mismatched tokens', async () => {
      const token = await csrf.generateToken();
      const tokenArray = token.split('');

      const token1 = ['X', ...tokenArray.slice(1)].join('');
      const token2 = [...tokenArray.slice(0, -1), 'X'].join('');

      for (let i = 0; i < 100; i++) {
        await expect(csrf.validateToken(token, token1)).resolves.toBe(false);
        await expect(csrf.validateToken(token, token2)).resolves.toBe(false);
      }
    });

    it('should generate tokens with strong character diversity', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 250 }, () => csrf.generateToken())
      );

      const validChars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const seenChars = new Set<string>();

      for (const token of tokens) {
        for (const char of token) {
          seenChars.add(char);
        }
      }

      expect(seenChars.size).toBeGreaterThanOrEqual(validChars.length - 2);
    });
  });

  describe('Error Handling', () => {
    it('should fail securely on Redis errors', async () => {
      const getClientMock =
        redisManager.getClient as jest.MockedFunction<typeof redisManager.getClient>;
      getClientMock.mockRejectedValueOnce(new Error('Redis unavailable'));

      const isValid = await csrf.validateToken('token1', 'token1');
      expect(isValid).toBe(false);
    });
  });
});
