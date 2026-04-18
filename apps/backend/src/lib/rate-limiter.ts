/**
 * Rate Limiter - Distributed Rate Limiting with Redis
 * 
 * === WHY RATE LIMITING? ===
 * Rate limiting protects your API from abuse by limiting how many requests
 * a user can make in a time window. This prevents:
 * 
 * 1. Brute Force Attacks: Attackers trying thousands of passwords
 * 2. Denial of Service: Overwhelming your server with requests
 * 3. Resource Exhaustion: One user consuming all your database connections
 * 4. Cost Control: Limiting expensive operations (like sending emails)
 * 
 * === WHY REDIS? ===
 * We use Redis instead of in-memory storage because:
 * 
 * 1. Distributed: Works across multiple backend servers
 *    - If you have 3 backend instances, they all share the same rate limit
 *    - Without Redis, each server would have its own counter (3x the limit!)
 * 
 * 2. Fast: Redis is in-memory, so checks are lightning fast (< 1ms)
 *    - We don't slow down legitimate users
 * 
 * 3. Atomic Operations: INCR command is atomic (thread-safe)
 *    - No race conditions when multiple requests arrive simultaneously
 * 
 * 4. Automatic Expiration: TTL (Time To Live) automatically cleans up old data
 *    - No memory leaks or manual cleanup needed
 * 
 * === SLIDING WINDOW ALGORITHM ===
 * We use a "sliding window" approach for accurate rate limiting:
 * 
 * Fixed Window Problem:
 * - Window: 0:00-0:15 (15 minutes)
 * - User makes 5 requests at 0:14
 * - User makes 5 requests at 0:16 (new window)
 * - Result: 10 requests in 2 minutes! (burst attack)
 * 
 * Sliding Window Solution:
 * - We track requests in overlapping time buckets
 * - Each request checks: "How many requests in the last 15 minutes?"
 * - This prevents burst attacks at window boundaries
 * 
 * Implementation:
 * - Key format: ratelimit:{endpoint}:{identifier}:{bucket}
 * - Bucket = floor(timestamp / windowMs)
 * - We check current bucket + previous bucket for sliding effect
 */

import { RedisClientType } from 'redis';
import { redisManager } from './redis';

/**
 * Configuration for a rate limiter
 * 
 * @property windowMs - Time window in milliseconds (e.g., 15 * 60 * 1000 = 15 minutes)
 * @property maxRequests - Maximum requests allowed in the window
 * @property keyPrefix - Prefix for Redis keys (e.g., "login", "register")
 */
export interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

/**
 * Result of a rate limit check
 * 
 * Either:
 * - { allowed: true } - Request is allowed, proceed
 * - { allowed: false, retryAfter: number } - Request blocked, retry after X seconds
 */
export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

/**
 * RateLimiter class - Implements distributed rate limiting
 * 
 * This class provides the core rate limiting logic using Redis.
 * It's designed to be used by middleware but can also be used directly.
 */
export class RateLimiter {
  private redis: RedisClientType | null = null;

  /**
   * Create a new RateLimiter
   * 
   * @param config - Rate limiter configuration
   * 
   * Example:
   * ```typescript
   * const loginLimiter = new RateLimiter({
   *   windowMs: 15 * 60 * 1000,  // 15 minutes
   *   maxRequests: 5,             // 5 requests max
   *   keyPrefix: 'login'          // Redis key prefix
   * });
   * ```
   */
  constructor(private config: RateLimiterConfig) {}

  /**
   * Get Redis client (lazy initialization)
   * 
   * We don't connect to Redis in the constructor because:
   * 1. Constructor should be fast and synchronous
   * 2. Redis might not be ready at startup
   * 3. We can handle connection errors gracefully
   */
  private async getRedis(): Promise<RedisClientType> {
    if (!this.redis) {
      this.redis = await redisManager.getClient();
    }
    return this.redis;
  }

  /**
   * Generate Redis key for rate limiting
   * 
   * Key format: ratelimit:{prefix}:{identifier}:{bucket}
   * 
   * Example: ratelimit:login:192.168.1.1:1234567890
   * 
   * Why include bucket in key?
   * - Each time window gets its own key
   * - Keys automatically expire (TTL) when window ends
   * - No manual cleanup needed
   * 
   * @param identifier - Who is making the request (IP address, email, user ID)
   * @param bucket - Time bucket (floor(timestamp / windowMs))
   */
  private getKey(identifier: string, bucket: number): string {
    return `ratelimit:${this.config.keyPrefix}:${identifier}:${bucket}`;
  }

  /**
   * Calculate which time bucket a timestamp belongs to
   * 
   * Example with 15-minute window (900,000 ms):
   * - Timestamp: 1,234,567,890,000 ms
   * - Bucket: floor(1,234,567,890,000 / 900,000) = 1,371,742
   * 
   * All requests in the same 15-minute period get the same bucket number.
   * 
   * @param timestamp - Unix timestamp in milliseconds
   */
  private getBucket(timestamp: number): number {
    return Math.floor(timestamp / this.config.windowMs);
  }

  /**
   * Check if a request should be allowed or rate limited
   * 
   * This is the main method you'll call for each request.
   * 
   * Algorithm:
   * 1. Calculate current time bucket
   * 2. Get request count from current bucket
   * 3. Get request count from previous bucket (for sliding window)
   * 4. Calculate weighted total (sliding window math)
   * 5. Compare to limit and return result
   * 
   * @param identifier - Who is making the request (IP, email, user ID)
   * @returns Promise<RateLimitResult> - Whether request is allowed
   */
  async checkLimit(identifier: string): Promise<RateLimitResult> {
    try {
      const redis = await this.getRedis();
      const now = Date.now();
      
      // Calculate current and previous time buckets
      const currentBucket = this.getBucket(now);
      const previousBucket = currentBucket - 1;
      
      // Generate Redis keys for both buckets
      const currentKey = this.getKey(identifier, currentBucket);
      const previousKey = this.getKey(identifier, previousBucket);
      
      // Get request counts from both buckets
      // We use GET instead of INCR here because we're just checking, not incrementing yet
      const [currentCount, previousCount] = await Promise.all([
        redis.get(currentKey).then(val => parseInt(val || '0', 10)),
        redis.get(previousKey).then(val => parseInt(val || '0', 10)),
      ]);
      
      /**
       * Sliding Window Calculation
       * 
       * We need to account for requests in the previous window that are still
       * within our time limit.
       * 
       * Example with 15-minute window:
       * - Previous window: 0:00 - 0:15
       * - Current window: 0:15 - 0:30
       * - Current time: 0:20 (5 minutes into current window)
       * 
       * We should count:
       * - 100% of requests in current window (0:15 - 0:20)
       * - 66% of requests in previous window (0:05 - 0:15, the last 10 minutes)
       * 
       * Formula:
       * - percentageOfPreviousWindow = (windowMs - timeIntoCurrentWindow) / windowMs
       * - totalRequests = currentCount + (previousCount * percentageOfPreviousWindow)
       */
      
      // How far into the current window are we?
      const timeIntoCurrentWindow = now % this.config.windowMs;
      
      // What percentage of the previous window is still relevant?
      const percentageOfPreviousWindow = 
        (this.config.windowMs - timeIntoCurrentWindow) / this.config.windowMs;
      
      // Calculate weighted total using sliding window
      const totalRequests = 
        currentCount + Math.floor(previousCount * percentageOfPreviousWindow);
      
      // Check if we're over the limit
      if (totalRequests >= this.config.maxRequests) {
        // Calculate when the user can retry
        // They need to wait until enough requests from the previous window expire
        const retryAfter = Math.ceil(
          (this.config.windowMs - timeIntoCurrentWindow) / 1000
        );
        
        return {
          allowed: false,
          retryAfter,
        };
      }
      
      // Request is allowed!
      return { allowed: true };
      
    } catch (error) {
      // If Redis is down, we fail open (allow the request)
      // This prevents Redis outages from taking down your entire API
      // 
      // Alternative: Fail closed (deny all requests) for maximum security
      // Trade-off: Availability vs Security
      console.error('Rate limiter error:', error);
      return { allowed: true };
    }
  }

  /**
   * Increment the request counter
   * 
   * Call this AFTER checkLimit() returns allowed: true
   * 
   * Why separate methods?
   * - checkLimit() is read-only (safe to call multiple times)
   * - incrementCounter() modifies state (call once per request)
   * - This separation makes testing easier
   * 
   * @param identifier - Who made the request
   */
  async incrementCounter(identifier: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      const now = Date.now();
      const currentBucket = this.getBucket(now);
      const key = this.getKey(identifier, currentBucket);
      
      /**
       * INCR command - Atomic increment
       * 
       * This is atomic, meaning:
       * - No race conditions even with concurrent requests
       * - If 10 requests arrive simultaneously, count increases by exactly 10
       * - No need for locks or transactions
       * 
       * Redis guarantees INCR is atomic because:
       * - Redis is single-threaded
       * - Commands execute one at a time
       * - No interleaving of operations
       */
      await redis.incr(key);
      
      /**
       * Set expiration (TTL) on the key
       * 
       * We set TTL to 2x the window size because:
       * - Current window needs to live for windowMs
       * - Previous window needs to live for another windowMs (for sliding window)
       * - After that, the data is no longer needed
       * 
       * EXPIRE command:
       * - Sets time-to-live in seconds
       * - Redis automatically deletes the key when TTL expires
       * - If key already has TTL, this updates it
       * 
       * NX flag: Only set expiration if key doesn't already have one
       * - Prevents resetting TTL on every request
       * - First request sets TTL, subsequent requests just increment
       */
      const ttlSeconds = Math.ceil((this.config.windowMs * 2) / 1000);
      await redis.expire(key, ttlSeconds, 'NX');
      
    } catch (error) {
      // Log error but don't throw
      // We already allowed the request, so we shouldn't fail now
      console.error('Failed to increment rate limit counter:', error);
    }
  }

  /**
   * Reset the counter for an identifier
   * 
   * Use cases:
   * - User successfully logs in (reset failed login counter)
   * - Admin manually resets a user's rate limit
   * - Testing (reset between test cases)
   * 
   * @param identifier - Who to reset
   */
  async resetCounter(identifier: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      const now = Date.now();
      const currentBucket = this.getBucket(now);
      const previousBucket = currentBucket - 1;
      
      // Delete both current and previous bucket keys
      // This ensures the sliding window calculation starts fresh
      const currentKey = this.getKey(identifier, currentBucket);
      const previousKey = this.getKey(identifier, previousBucket);
      
      await Promise.all([
        redis.del(currentKey),
        redis.del(previousKey),
      ]);
      
    } catch (error) {
      console.error('Failed to reset rate limit counter:', error);
      throw error;
    }
  }
}

/**
 * Pre-configured rate limiters for common use cases
 * 
 * These match the requirements from the spec:
 * - Login: 5 requests per 15 minutes
 * - Registration: 3 requests per hour
 * - Password Reset: 3 requests per hour
 */

export const loginRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  keyPrefix: 'login',
});

export const registrationRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  keyPrefix: 'register',
});

export const passwordResetRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  keyPrefix: 'password_reset',
});
