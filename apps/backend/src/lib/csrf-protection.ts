/**
 * CSRF Protection - Cross-Site Request Forgery Defense
 * 
 * === WHAT IS CSRF? ===
 * CSRF (Cross-Site Request Forgery) is an attack where a malicious website
 * tricks your browser into making unwanted requests to a site you're logged into.
 * 
 * Example Attack Scenario:
 * 1. You log into yourbank.com (you have a valid session cookie)
 * 2. You visit evil.com (in another tab)
 * 3. evil.com has hidden code: <form action="yourbank.com/transfer" method="POST">
 * 4. Your browser automatically sends your yourbank.com cookies with the request!
 * 5. The bank thinks it's you and transfers money to the attacker
 * 
 * The Problem:
 * - Browsers automatically include cookies in requests
 * - The bank can't tell if YOU clicked the button or evil.com did
 * - Session cookies alone aren't enough to verify intent
 * 
 * === HOW CSRF PROTECTION WORKS ===
 * We use the "Double-Submit Cookie Pattern":
 * 
 * 1. Server generates a random CSRF token
 * 2. Server sends token in TWO places:
 *    a) In a cookie (browser stores it)
 *    b) In the response body (frontend stores it)
 * 
 * 3. Frontend includes token in TWO places when making requests:
 *    a) Cookie (browser sends automatically)
 *    b) Custom header: X-CSRF-Token (frontend must explicitly add)
 * 
 * 4. Server validates: Cookie token === Header token
 * 
 * Why This Works:
 * - evil.com can trigger requests that include cookies (automatic)
 * - BUT evil.com CANNOT read your cookies (Same-Origin Policy)
 * - So evil.com cannot get the token to put in the header
 * - Only YOUR frontend (same origin) can read the cookie and add the header
 * 
 * === WHY SAMESITE=STRICT? ===
 * SameSite=Strict is an additional defense layer:
 * 
 * - SameSite=Strict: Browser NEVER sends cookie in cross-site requests
 * - Even if evil.com tries to make a request, the cookie won't be included
 * - This blocks CSRF attacks at the browser level
 * 
 * Defense in Depth:
 * - SameSite=Strict: First line of defense (browser blocks cross-site cookies)
 * - CSRF Token: Second line of defense (server validates token)
 * - Both together provide maximum protection
 * 
 * === WHY CONSTANT-TIME COMPARISON? ===
 * Timing attacks are subtle but dangerous:
 * 
 * Normal String Comparison (VULNERABLE):
 * ```
 * if (token1 === token2) // Stops at first different character
 * ```
 * 
 * Problem:
 * - "aaaa" vs "baaa" fails fast (1 comparison)
 * - "aaaa" vs "aaab" fails slow (4 comparisons)
 * - Attacker measures response time to guess token character by character!
 * 
 * Constant-Time Comparison (SECURE):
 * ```
 * // Always compares ALL characters, regardless of differences
 * ```
 * 
 * - "aaaa" vs "baaa" takes same time as "aaaa" vs "aaab"
 * - Attacker cannot learn anything from timing
 * - Prevents token guessing attacks
 * 
 * === TOKEN STORAGE: REDIS VS DATABASE ===
 * We use Redis for CSRF tokens because:
 * 
 * 1. Speed: CSRF checks happen on EVERY request
 *    - Redis: < 1ms (in-memory)
 *    - Database: 10-50ms (disk I/O)
 * 
 * 2. Automatic Expiration: Tokens expire after 1 hour
 *    - Redis: Built-in TTL, automatic cleanup
 *    - Database: Need background job to delete expired tokens
 * 
 * 3. Ephemeral Data: CSRF tokens are temporary
 *    - Don't need durability (if Redis restarts, users just get new tokens)
 *    - Don't need complex queries
 *    - Perfect fit for cache
 * 
 * 4. Distributed: Works across multiple backend servers
 *    - All servers share the same Redis
 *    - Token generated on server A works on server B
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { RedisClientType } from 'redis';
import { redisManager } from './redis';

/**
 * Configuration for CSRF protection
 * 
 * @property tokenLength - Length of token in bytes (32 bytes = 256 bits)
 * @property cookieName - Name of the cookie storing the token
 * @property headerName - Name of the header containing the token
 * @property tokenExpiration - How long tokens are valid (in seconds)
 */
export interface CSRFConfig {
  tokenLength: number;
  cookieName: string;
  headerName: string;
  tokenExpiration: number;
}

/**
 * Default CSRF configuration
 * 
 * These values match the security requirements:
 * - 32 bytes (256 bits) for cryptographic strength
 * - 1 hour expiration (3600 seconds)
 * - Standard naming conventions
 */
export const DEFAULT_CSRF_CONFIG: CSRFConfig = {
  tokenLength: 32, // 32 bytes = 256 bits of entropy
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  tokenExpiration: 3600, // 1 hour in seconds
};

/**
 * CSRFProtection class - Implements CSRF defense
 * 
 * This class provides token generation and validation for CSRF protection.
 * It uses Redis for distributed token storage and constant-time comparison
 * for security.
 */
export class CSRFProtection {
  private redis: RedisClientType | null = null;

  /**
   * Create a new CSRFProtection instance
   * 
   * @param config - CSRF configuration (optional, uses defaults if not provided)
   * 
   * Example:
   * ```typescript
   * const csrf = new CSRFProtection();
   * const token = await csrf.generateToken();
   * const isValid = await csrf.validateToken(cookieToken, headerToken);
   * ```
   */
  constructor(private config: CSRFConfig = DEFAULT_CSRF_CONFIG) {}

  /**
   * Get Redis client (lazy initialization)
   * 
   * We don't connect in the constructor because:
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
   * Generate Redis key for storing CSRF token
   * 
   * Key format: csrf:{token}
   * 
   * Why store token as key instead of value?
   * - Fast lookup: O(1) to check if token exists
   * - Automatic expiration: Redis TTL deletes the key
   * - Simple: No need for complex data structures
   * 
   * @param token - The CSRF token
   */
  private getKey(token: string): string {
    return `csrf:${token}`;
  }

  /**
   * Generate a cryptographically secure CSRF token
   * 
   * This is the core of CSRF protection - generating unpredictable tokens.
   * 
   * Why crypto.randomBytes()?
   * - Uses OS-level randomness (e.g., /dev/urandom on Linux)
   * - Cryptographically secure (unpredictable, no patterns)
   * - Much better than Math.random() (predictable, not secure)
   * 
   * Why 32 bytes?
   * - 32 bytes = 256 bits of entropy
   * - 2^256 possible tokens (more than atoms in the universe!)
   * - Impossible to guess even with billions of attempts
   * 
   * Why base64url encoding?
   * - Binary data needs to be text for HTTP headers/cookies
   * - base64url is URL-safe (no +, /, = characters that need escaping)
   * - Compact representation (43 characters for 32 bytes)
   * 
   * @returns Promise<string> - The generated token (base64url encoded)
   */
  async generateToken(): Promise<string> {
    try {
      // Generate cryptographically secure random bytes
      // This is the same function used for:
      // - Session tokens
      // - Password reset tokens
      // - API keys
      const tokenBytes = randomBytes(this.config.tokenLength);
      
      // Convert binary data to base64url string
      // base64url is like base64 but URL-safe:
      // - Replaces + with -
      // - Replaces / with _
      // - Removes = padding
      const token = tokenBytes.toString('base64url');
      
      // Store token in Redis with expiration
      const redis = await this.getRedis();
      const key = this.getKey(token);
      
      /**
       * Store token with metadata
       * 
       * We store:
       * - created_at: When token was generated (for debugging)
       * - TTL: Automatic expiration after 1 hour
       * 
       * Why store metadata?
       * - Debugging: "When was this token created?"
       * - Auditing: Track token usage patterns
       * - Future: Could add user_id, ip_address, etc.
       */
      await redis.set(
        key,
        JSON.stringify({
          created_at: new Date().toISOString(),
        }),
        {
          EX: this.config.tokenExpiration, // Expire after 1 hour
        }
      );
      
      return token;
      
    } catch (error) {
      console.error('Failed to generate CSRF token:', error);
      throw new Error('Failed to generate CSRF token');
    }
  }

  /**
   * Validate a CSRF token using constant-time comparison
   * 
   * This is the security-critical function that prevents CSRF attacks.
   * 
   * Validation Steps:
   * 1. Check both tokens are present (not null/undefined/empty)
   * 2. Check both tokens have the same length (prevents timing attacks)
   * 3. Check cookie token exists in Redis (not expired)
   * 4. Compare cookie token === header token (constant-time)
   * 
   * Why constant-time comparison?
   * - Prevents timing attacks (explained in header comments)
   * - Uses crypto.timingSafeEqual() which always takes the same time
   * - Critical for security even though tokens are random
   * 
   * @param cookieToken - Token from cookie (browser sends automatically)
   * @param headerToken - Token from header (frontend must add explicitly)
   * @returns Promise<boolean> - True if valid, false otherwise
   */
  async validateToken(
    cookieToken: string | undefined,
    headerToken: string | undefined
  ): Promise<boolean> {
    try {
      // Step 1: Check both tokens are present
      if (!cookieToken || !headerToken) {
        console.warn('CSRF validation failed: Missing token');
        return false;
      }
      
      // Step 2: Check tokens have the same length
      // This is important for timingSafeEqual (requires same length)
      // Also prevents timing attacks on length comparison
      if (cookieToken.length !== headerToken.length) {
        console.warn('CSRF validation failed: Token length mismatch');
        return false;
      }
      
      // Step 3: Check cookie token exists in Redis (not expired)
      const redis = await this.getRedis();
      const key = this.getKey(cookieToken);
      const exists = await redis.exists(key);
      
      if (!exists) {
        console.warn('CSRF validation failed: Token not found or expired');
        return false;
      }
      
      /**
       * Step 4: Constant-time comparison
       * 
       * We use crypto.timingSafeEqual() instead of === because:
       * 
       * === comparison (VULNERABLE):
       * - Stops at first different character
       * - "aaaa" vs "baaa" is faster than "aaaa" vs "aaab"
       * - Attacker can measure time to guess token
       * 
       * timingSafeEqual (SECURE):
       * - Always compares ALL characters
       * - Same time regardless of where difference is
       * - Prevents timing attacks
       * 
       * How it works:
       * - Converts strings to Buffers (binary data)
       * - XORs all bytes together
       * - Returns true only if XOR result is all zeros
       * - Takes same time for any input
       */
      const cookieBuffer = Buffer.from(cookieToken, 'utf-8');
      const headerBuffer = Buffer.from(headerToken, 'utf-8');
      
      const tokensMatch = timingSafeEqual(cookieBuffer, headerBuffer);
      
      if (!tokensMatch) {
        console.warn('CSRF validation failed: Token mismatch');
        return false;
      }
      
      // All checks passed! Token is valid.
      return true;
      
    } catch (error) {
      // If Redis is down or any error occurs, fail securely (deny request)
      // This is different from rate limiting where we fail open
      // 
      // Why fail closed for CSRF?
      // - CSRF protection is critical security
      // - Better to block legitimate users than allow attacks
      // - Users can retry when Redis is back
      console.error('CSRF validation error:', error);
      return false;
    }
  }

  /**
   * Invalidate a CSRF token
   * 
   * Use cases:
   * - Token has been used (single-use tokens)
   * - User logs out (invalidate all tokens)
   * - Security incident (revoke all tokens)
   * 
   * Note: Current implementation allows token reuse within expiration window.
   * For single-use tokens, call this method after successful validation.
   * 
   * @param token - The token to invalidate
   */
  async invalidateToken(token: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      const key = this.getKey(token);
      await redis.del(key);
    } catch (error) {
      console.error('Failed to invalidate CSRF token:', error);
      // Don't throw - invalidation failure is not critical
    }
  }

  /**
   * Check if a token exists and is valid (without comparing)
   * 
   * Useful for:
   * - Debugging: "Is this token still valid?"
   * - Monitoring: "How many active tokens?"
   * - Testing: Verify token was created
   * 
   * @param token - The token to check
   * @returns Promise<boolean> - True if token exists in Redis
   */
  async tokenExists(token: string): Promise<boolean> {
    try {
      const redis = await this.getRedis();
      const key = this.getKey(token);
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Failed to check token existence:', error);
      return false;
    }
  }
}

/**
 * Singleton instance for application-wide use
 * 
 * Why singleton?
 * - All parts of the app use the same configuration
 * - Shares Redis connection pool
 * - Consistent behavior across all endpoints
 * 
 * Usage:
 * ```typescript
 * import { csrfProtection } from './csrf-protection';
 * 
 * const token = await csrfProtection.generateToken();
 * const isValid = await csrfProtection.validateToken(cookieToken, headerToken);
 * ```
 */
export const csrfProtection = new CSRFProtection();
