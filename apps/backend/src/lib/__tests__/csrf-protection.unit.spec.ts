/**
 * CSRF Protection Tests
 * 
 * These tests verify that our CSRF protection implementation works correctly
 * and securely. We test:
 * 
 * 1. Token Generation: Tokens are unique, properly formatted, and stored
 * 2. Token Validation: Correct tokens pass, incorrect tokens fail
 * 3. Expiration: Tokens expire after the configured time
 * 4. Security: Constant-time comparison prevents timing attacks
 * 5. Edge Cases: Missing tokens, empty strings, malformed data
 */

import { CSRFProtection, DEFAULT_CSRF_CONFIG } from '../csrf-protection';
import { redisManager } from '../redis';

describe('CSRFProtection', () => {
  let csrf: CSRFProtection;

  beforeAll(async () => {
    // Ensure Redis is connected before running tests
    await redisManager.getClient();
  });

  beforeEach(() => {
    // Create a fresh instance for each test
    csrf = new CSRFProtection();
  });

  afterEach(async () => {
    // Clean up: Delete all test tokens from Redis
    const redis = await redisManager.getClient();
    const keys = await redis.keys('csrf:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  });

  afterAll(async () => {
    // Disconnect from Redis after all tests
    await redisManager.disconnect();
  });

  describe('Token Generation', () => {
    /**
     * Test: Tokens should be generated successfully
     * 
     * Why this matters:
     * - Token generation is the foundation of CSRF protection
     * - If this fails, the entire system fails
     */
    it('should generate a token successfully', async () => {
      const token = await csrf.generateToken();
      
      // Token should be a non-empty string
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    /**
     * Test: Tokens should be unique
     * 
     * Why this matters:
     * - Duplicate tokens would allow one user's token to work for another
     * - This would completely break CSRF protection
     * 
     * How we test:
     * - Generate 100 tokens
     * - Check that all are unique (no duplicates)
     */
    it('should generate unique tokens', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 100 }, () => csrf.generateToken())
      );
      
      // Convert to Set to remove duplicates
      const uniqueTokens = new Set(tokens);
      
      // All tokens should be unique
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    /**
     * Test: Tokens should have correct format
     * 
     * Why this matters:
     * - Tokens must be base64url encoded (URL-safe)
     * - Tokens must have correct length (32 bytes = 43 characters in base64url)
     * 
     * base64url format:
     * - Only characters: A-Z, a-z, 0-9, -, _
     * - No padding (=) characters
     * - 32 bytes = 43 characters when base64url encoded
     */
    it('should generate tokens with correct format', async () => {
      const token = await csrf.generateToken();
      
      // Should be base64url format (A-Z, a-z, 0-9, -, _)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      
      // 32 bytes = 43 characters in base64url
      expect(token.length).toBe(43);
    });

    /**
     * Test: Tokens should be stored in Redis
     * 
     * Why this matters:
     * - We need to verify tokens later
     * - If token isn't stored, validation will always fail
     */
    it('should store token in Redis', async () => {
      const token = await csrf.generateToken();
      
      // Check token exists in Redis
      const exists = await csrf.tokenExists(token);
      expect(exists).toBe(true);
    });

    /**
     * Test: Tokens should have expiration set
     * 
     * Why this matters:
     * - Tokens must expire to limit attack window
     * - Without expiration, tokens would accumulate forever (memory leak)
     */
    it('should set expiration on token', async () => {
      const token = await csrf.generateToken();
      
      // Get TTL (time to live) from Redis
      const redis = await redisManager.getClient();
      const key = `csrf:${token}`;
      const ttl = await redis.ttl(key);
      
      // TTL should be set (not -1 which means no expiration)
      expect(ttl).toBeGreaterThan(0);
      
      // TTL should be approximately 1 hour (3600 seconds)
      // Allow 10 second margin for test execution time
      expect(ttl).toBeGreaterThanOrEqual(3590);
      expect(ttl).toBeLessThanOrEqual(3600);
    });
  });

  describe('Token Validation', () => {
    /**
     * Test: Valid tokens should pass validation
     * 
     * Why this matters:
     * - This is the happy path - legitimate users should be allowed
     * - If this fails, all requests would be blocked
     */
    it('should validate matching tokens', async () => {
      const token = await csrf.generateToken();
      
      // Same token in both cookie and header should validate
      const isValid = await csrf.validateToken(token, token);
      expect(isValid).toBe(true);
    });

    /**
     * Test: Mismatched tokens should fail validation
     * 
     * Why this matters:
     * - This is the attack scenario - attacker has wrong token
     * - If this passes, CSRF protection is broken
     */
    it('should reject mismatched tokens', async () => {
      const token1 = await csrf.generateToken();
      const token2 = await csrf.generateToken();
      
      // Different tokens should not validate
      const isValid = await csrf.validateToken(token1, token2);
      expect(isValid).toBe(false);
    });

    /**
     * Test: Missing cookie token should fail
     * 
     * Why this matters:
     * - Attacker might not have access to cookie
     * - Must reject requests with missing cookie token
     */
    it('should reject missing cookie token', async () => {
      const token = await csrf.generateToken();
      
      const isValid = await csrf.validateToken(undefined, token);
      expect(isValid).toBe(false);
    });

    /**
     * Test: Missing header token should fail
     * 
     * Why this matters:
     * - This is the key defense - attacker cannot set custom headers
     * - Must reject requests with missing header token
     */
    it('should reject missing header token', async () => {
      const token = await csrf.generateToken();
      
      const isValid = await csrf.validateToken(token, undefined);
      expect(isValid).toBe(false);
    });

    /**
     * Test: Empty tokens should fail
     * 
     * Why this matters:
     * - Edge case: empty string is different from undefined
     * - Must handle all falsy values correctly
     */
    it('should reject empty tokens', async () => {
      const isValid1 = await csrf.validateToken('', '');
      expect(isValid1).toBe(false);
      
      const token = await csrf.generateToken();
      const isValid2 = await csrf.validateToken(token, '');
      expect(isValid2).toBe(false);
      
      const isValid3 = await csrf.validateToken('', token);
      expect(isValid3).toBe(false);
    });

    /**
     * Test: Non-existent tokens should fail
     * 
     * Why this matters:
     * - Attacker might try to guess tokens
     * - Must reject tokens that were never generated
     */
    it('should reject non-existent tokens', async () => {
      // Create a fake token that was never generated
      const fakeToken = 'fake-token-that-does-not-exist-in-redis';
      
      const isValid = await csrf.validateToken(fakeToken, fakeToken);
      expect(isValid).toBe(false);
    });

    /**
     * Test: Tokens with different lengths should fail
     * 
     * Why this matters:
     * - Prevents timing attacks on length comparison
     * - timingSafeEqual requires same length
     */
    it('should reject tokens with different lengths', async () => {
      const token = await csrf.generateToken();
      const shortToken = token.substring(0, 10);
      
      const isValid = await csrf.validateToken(token, shortToken);
      expect(isValid).toBe(false);
    });
  });

  describe('Token Expiration', () => {
    /**
     * Test: Expired tokens should fail validation
     * 
     * Why this matters:
     * - Limits attack window (attacker has limited time)
     * - Prevents token reuse after long periods
     * 
     * How we test:
     * - Create token with very short expiration (1 second)
     * - Wait for expiration
     * - Verify token is rejected
     */
    it('should reject expired tokens', async () => {
      // Create CSRF instance with 1-second expiration for testing
      const shortLivedCsrf = new CSRFProtection({
        ...DEFAULT_CSRF_CONFIG,
        tokenExpiration: 1, // 1 second
      });
      
      const token = await shortLivedCsrf.generateToken();
      
      // Token should be valid immediately
      const isValidBefore = await shortLivedCsrf.validateToken(token, token);
      expect(isValidBefore).toBe(true);
      
      // Wait for token to expire (1.5 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Token should be invalid after expiration
      const isValidAfter = await shortLivedCsrf.validateToken(token, token);
      expect(isValidAfter).toBe(false);
    });

    /**
     * Test: Token should not exist after expiration
     * 
     * Why this matters:
     * - Verifies Redis TTL is working correctly
     * - Ensures automatic cleanup happens
     */
    it('should remove token from Redis after expiration', async () => {
      const shortLivedCsrf = new CSRFProtection({
        ...DEFAULT_CSRF_CONFIG,
        tokenExpiration: 1,
      });
      
      const token = await shortLivedCsrf.generateToken();
      
      // Token should exist immediately
      const existsBefore = await shortLivedCsrf.tokenExists(token);
      expect(existsBefore).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Token should not exist after expiration
      const existsAfter = await shortLivedCsrf.tokenExists(token);
      expect(existsAfter).toBe(false);
    });
  });

  describe('Token Invalidation', () => {
    /**
     * Test: Invalidated tokens should fail validation
     * 
     * Why this matters:
     * - Allows manual token revocation (logout, security incident)
     * - Enables single-use token pattern
     */
    it('should invalidate token', async () => {
      const token = await csrf.generateToken();
      
      // Token should be valid before invalidation
      const isValidBefore = await csrf.validateToken(token, token);
      expect(isValidBefore).toBe(true);
      
      // Invalidate token
      await csrf.invalidateToken(token);
      
      // Token should be invalid after invalidation
      const isValidAfter = await csrf.validateToken(token, token);
      expect(isValidAfter).toBe(false);
    });

    /**
     * Test: Invalidated token should not exist in Redis
     * 
     * Why this matters:
     * - Verifies token is actually deleted
     * - Ensures no memory leak
     */
    it('should remove token from Redis on invalidation', async () => {
      const token = await csrf.generateToken();
      
      // Token should exist before invalidation
      const existsBefore = await csrf.tokenExists(token);
      expect(existsBefore).toBe(true);
      
      // Invalidate token
      await csrf.invalidateToken(token);
      
      // Token should not exist after invalidation
      const existsAfter = await csrf.tokenExists(token);
      expect(existsAfter).toBe(false);
    });
  });

  describe('Security Properties', () => {
    /**
     * Test: Constant-time comparison
     * 
     * Why this matters:
     * - Prevents timing attacks
     * - Attacker cannot guess token by measuring response time
     * 
     * How we test:
     * - Compare tokens that differ at different positions
     * - Measure time for each comparison
     * - Verify times are similar (within margin of error)
     * 
     * Note: This is a basic test. Real timing attacks require
     * thousands of measurements and statistical analysis.
     */
    it('should use constant-time comparison', async () => {
      const token = await csrf.generateToken();
      
      // Create tokens that differ at different positions
      const tokenArray = token.split('');
      
      // Differ at first character
      const token1 = ['X', ...tokenArray.slice(1)].join('');
      
      // Differ at last character
      const token2 = [...tokenArray.slice(0, -1), 'X'].join('');
      
      // Measure time for first comparison
      const start1 = process.hrtime.bigint();
      await csrf.validateToken(token, token1);
      const end1 = process.hrtime.bigint();
      const time1 = Number(end1 - start1);
      
      // Measure time for second comparison
      const start2 = process.hrtime.bigint();
      await csrf.validateToken(token, token2);
      const end2 = process.hrtime.bigint();
      const time2 = Number(end2 - start2);
      
      // Times should be similar (within 50% margin)
      // This is a loose check because:
      // - Test environment has noise (other processes, GC, etc.)
      // - We're testing the principle, not exact timing
      const ratio = time1 / time2;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2.0);
    });

    /**
     * Test: Tokens should have high entropy
     * 
     * Why this matters:
     * - Low entropy = predictable tokens = easy to guess
     * - High entropy = unpredictable tokens = impossible to guess
     * 
     * How we test:
     * - Generate many tokens
     * - Check character distribution is roughly uniform
     * - Verify no obvious patterns
     */
    it('should generate tokens with high entropy', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 100 }, () => csrf.generateToken())
      );
      
      // Count character frequency
      const charCounts: Record<string, number> = {};
      const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      
      for (const char of validChars) {
        charCounts[char] = 0;
      }
      
      for (const token of tokens) {
        for (const char of token) {
          charCounts[char] = (charCounts[char] || 0) + 1;
        }
      }
      
      // Calculate average frequency
      const totalChars = tokens.reduce((sum, token) => sum + token.length, 0);
      const avgFrequency = totalChars / validChars.length;
      
      // Each character should appear roughly equally often
      // Allow 50% deviation (this is a basic entropy check)
      for (const char of validChars) {
        const frequency = charCounts[char];
        expect(frequency).toBeGreaterThan(avgFrequency * 0.5);
        expect(frequency).toBeLessThan(avgFrequency * 1.5);
      }
    });
  });

  describe('Error Handling', () => {
    /**
     * Test: Should handle Redis errors gracefully
     * 
     * Why this matters:
     * - Redis might be down or unreachable
     * - Should fail securely (deny request) not crash
     */
    it('should fail securely on Redis errors', async () => {
      // Disconnect Redis to simulate error
      await redisManager.disconnect();
      
      // Validation should fail (not throw)
      const isValid = await csrf.validateToken('token1', 'token1');
      expect(isValid).toBe(false);
      
      // Reconnect for other tests
      await redisManager.getClient();
    });
  });
});
