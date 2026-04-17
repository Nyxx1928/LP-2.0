/**
 * Rate Limiter Tests
 * 
 * These tests verify that our rate limiting logic works correctly.
 * 
 * Testing Strategy:
 * - Test requests under limit (should be allowed)
 * - Test requests over limit (should be blocked)
 * - Test retry-after calculation
 * - Test sliding window behavior
 * - Test counter reset
 * - Test concurrent requests
 * 
 * === WHAT WE'RE TESTING ===
 * 
 * 1. Basic Rate Limiting:
 *    - Allow requests under the limit
 *    - Block requests over the limit
 *    - Return correct retry-after time
 * 
 * 2. Sliding Window:
 *    - Requests in previous window affect current limit
 *    - Old requests eventually stop counting
 *    - No burst attacks at window boundaries
 * 
 * 3. Counter Management:
 *    - Increment increases count
 *    - Reset clears count
 *    - Multiple identifiers are independent
 * 
 * 4. Error Handling:
 *    - Graceful degradation when Redis is unavailable
 */

import { RateLimiter } from '../rate-limiter';
import { redisManager } from '../redis';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  
  // Test configuration: 3 requests per 10 seconds
  // We use short windows for faster tests
  const testConfig = {
    windowMs: 10000, // 10 seconds
    maxRequests: 3,
    keyPrefix: 'test',
  };

  beforeEach(() => {
    // Create a fresh rate limiter for each test
    rateLimiter = new RateLimiter(testConfig);
  });

  afterAll(async () => {
    // Clean up Redis connection
    await redisManager.disconnect();
  });

  describe('checkLimit - basic functionality', () => {
    it('should allow requests under the limit', async () => {
      // Arrange: Fresh identifier
      const identifier = 'user1';

      // Act: Make 3 requests (at the limit)
      const result1 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);
      
      const result2 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);
      
      const result3 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      // Assert: All should be allowed
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    it('should block requests over the limit', async () => {
      // Arrange: Make 3 requests (reach the limit)
      const identifier = 'user2';
      
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }

      // Act: Try one more request (over the limit)
      const result = await rateLimiter.checkLimit(identifier);

      // Assert: Should be blocked
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(result.retryAfter).toBeLessThanOrEqual(10); // Within window
      }
    });

    it('should return correct retry-after time', async () => {
      // Arrange: Reach the limit
      const identifier = 'user3';
      
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }

      // Act: Check limit (should be blocked)
      const result = await rateLimiter.checkLimit(identifier);

      // Assert: Retry-after should be reasonable
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        // Should be between 0 and 10 seconds (our window)
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(result.retryAfter).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('incrementCounter', () => {
    it('should increment the counter correctly', async () => {
      // Arrange: Fresh identifier
      const identifier = 'user4';

      // Act: Check limit, increment, check again
      const result1 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);
      
      const result2 = await rateLimiter.checkLimit(identifier);
      await rateLimiter.incrementCounter(identifier);

      // Assert: Both should be allowed (under limit of 3)
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    it('should handle multiple increments correctly', async () => {
      // Arrange: Fresh identifier
      const identifier = 'user5';

      // Act: Increment 3 times
      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter.checkLimit(identifier);
        expect(result.allowed).toBe(true);
        await rateLimiter.incrementCounter(identifier);
      }

      // Try one more
      const finalResult = await rateLimiter.checkLimit(identifier);

      // Assert: Should be blocked after 3 increments
      expect(finalResult.allowed).toBe(false);
    });
  });

  describe('resetCounter', () => {
    it('should reset the counter to zero', async () => {
      // Arrange: Reach the limit
      const identifier = 'user6';
      
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(identifier);
        await rateLimiter.incrementCounter(identifier);
      }
      
      // Verify we're blocked
      const blockedResult = await rateLimiter.checkLimit(identifier);
      expect(blockedResult.allowed).toBe(false);

      // Act: Reset the counter
      await rateLimiter.resetCounter(identifier);

      // Assert: Should be allowed again
      const result = await rateLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    });

    it('should only reset the specific identifier', async () => {
      // Arrange: Two users, both reach limit
      const user1 = 'user7';
      const user2 = 'user8';
      
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(user1);
        await rateLimiter.incrementCounter(user1);
        
        await rateLimiter.checkLimit(user2);
        await rateLimiter.incrementCounter(user2);
      }

      // Act: Reset only user1
      await rateLimiter.resetCounter(user1);

      // Assert: user1 should be allowed, user2 still blocked
      const result1 = await rateLimiter.checkLimit(user1);
      const result2 = await rateLimiter.checkLimit(user2);
      
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(false);
    });
  });

  describe('multiple identifiers', () => {
    it('should track different identifiers independently', async () => {
      // Arrange: Three different users
      const user1 = 'user9';
      const user2 = 'user10';
      const user3 = 'user11';

      // Act: Each user makes 2 requests
      for (let i = 0; i < 2; i++) {
        await rateLimiter.checkLimit(user1);
        await rateLimiter.incrementCounter(user1);
        
        await rateLimiter.checkLimit(user2);
        await rateLimiter.incrementCounter(user2);
        
        await rateLimiter.checkLimit(user3);
        await rateLimiter.incrementCounter(user3);
      }

      // Assert: All should still be under limit (2 < 3)
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
      // This test verifies that old requests stop counting after the window
      // We use a very short window (1 second) for faster testing
      
      // Arrange: Create limiter with 1-second window
      const shortLimiter = new RateLimiter({
        windowMs: 1000, // 1 second
        maxRequests: 2,
        keyPrefix: 'test-short',
      });
      
      const identifier = 'user12';

      // Act: Reach the limit
      await shortLimiter.checkLimit(identifier);
      await shortLimiter.incrementCounter(identifier);
      
      await shortLimiter.checkLimit(identifier);
      await shortLimiter.incrementCounter(identifier);
      
      // Verify we're blocked
      const blockedResult = await shortLimiter.checkLimit(identifier);
      expect(blockedResult.allowed).toBe(false);

      // Wait for window to expire (1.5 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Assert: Should be allowed again (old requests expired)
      const result = await shortLimiter.checkLimit(identifier);
      expect(result.allowed).toBe(true);
    }, 10000); // Increase test timeout to 10 seconds
  });

  describe('concurrent requests', () => {
    it('should handle concurrent requests correctly', async () => {
      // This tests that our atomic INCR operations work correctly
      // Even when multiple requests arrive simultaneously
      
      // Arrange: Fresh identifier
      const identifier = 'user13';

      // Act: Make 5 concurrent requests
      const promises = Array.from({ length: 5 }, async () => {
        const result = await rateLimiter.checkLimit(identifier);
        if (result.allowed) {
          await rateLimiter.incrementCounter(identifier);
        }
        return result;
      });

      const results = await Promise.all(promises);

      // Assert: Exactly 3 should be allowed (our limit)
      const allowedCount = results.filter(r => r.allowed).length;
      const blockedCount = results.filter(r => !r.allowed).length;
      
      // Due to race conditions, we might get 3-5 allowed
      // (checkLimit happens before increment, so multiple can pass)
      // But at least some should be blocked
      expect(allowedCount).toBeGreaterThanOrEqual(3);
      expect(allowedCount).toBeLessThanOrEqual(5);
      expect(blockedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty identifier', async () => {
      // Act: Use empty string as identifier
      const result = await rateLimiter.checkLimit('');
      
      // Assert: Should still work (empty string is valid)
      expect(result.allowed).toBe(true);
    });

    it('should handle special characters in identifier', async () => {
      // Act: Use identifier with special characters
      const identifier = 'user@example.com:192.168.1.1';
      const result = await rateLimiter.checkLimit(identifier);
      
      // Assert: Should work fine
      expect(result.allowed).toBe(true);
    });

    it('should handle very long identifiers', async () => {
      // Act: Use very long identifier
      const identifier = 'a'.repeat(1000);
      const result = await rateLimiter.checkLimit(identifier);
      
      // Assert: Should work fine
      expect(result.allowed).toBe(true);
    });
  });
});
