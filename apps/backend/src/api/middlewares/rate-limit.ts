/**
 * Rate Limiting Middleware
 * 
 * This middleware integrates the RateLimiter class with Medusa's HTTP layer.
 * It extracts the identifier (IP address or email), checks the rate limit,
 * and returns appropriate HTTP responses.
 * 
 * === HTTP 429 TOO MANY REQUESTS ===
 * When rate limit is exceeded, we return:
 * - Status: 429 (standard HTTP code for rate limiting)
 * - Retry-After header: Tells client when to retry (in seconds)
 * - Error message: User-friendly explanation
 * 
 * === IDENTIFIER STRATEGIES ===
 * We can rate limit by different identifiers:
 * 
 * 1. IP Address (default):
 *    - Pros: Works for anonymous users, prevents distributed attacks
 *    - Cons: Shared IPs (NAT, VPN) affect multiple users
 * 
 * 2. Email Address:
 *    - Pros: Per-user limit, fair for shared IPs
 *    - Cons: Attacker can use different emails
 * 
 * 3. User ID:
 *    - Pros: Most accurate per-user limit
 *    - Cons: Only works for authenticated requests
 * 
 * We use IP for login/registration (anonymous) and email for password reset.
 */

import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from '@medusajs/framework/http';
import { RateLimiter } from '../../lib/rate-limiter';

/**
 * Extract IP address from request
 * 
 * IP address can be in different places depending on your infrastructure:
 * 
 * 1. Direct connection: req.ip
 * 2. Behind proxy (nginx, CloudFlare): X-Forwarded-For header
 * 3. Behind load balancer: X-Real-IP header
 * 
 * X-Forwarded-For format: "client, proxy1, proxy2"
 * We take the first IP (the original client)
 * 
 * Security note: X-Forwarded-For can be spoofed!
 * Only trust it if you control the proxy/load balancer.
 * 
 * @param req - Medusa request object
 * @returns IP address as string
 */
function getClientIp(req: MedusaRequest): string {
  // Check X-Forwarded-For header (most common with proxies)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP in the list (original client)
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }
  
  // Check X-Real-IP header (some load balancers)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  
  // Fall back to direct connection IP
  return req.ip || 'unknown';
}

/**
 * Create rate limiting middleware
 * 
 * This is a factory function that creates middleware configured with
 * a specific RateLimiter instance.
 * 
 * Why a factory?
 * - Different endpoints need different rate limits
 * - We can create multiple middleware instances with different configs
 * - Each middleware is independent and reusable
 * 
 * @param rateLimiter - Configured RateLimiter instance
 * @param getIdentifier - Function to extract identifier from request (default: IP address)
 * @returns Middleware function
 * 
 * Example usage:
 * ```typescript
 * import { loginRateLimiter } from '../../lib/rate-limiter';
 * 
 * // In your route:
 * router.post('/login',
 *   createRateLimitMiddleware(loginRateLimiter),
 *   loginHandler
 * );
 * ```
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  getIdentifier: (req: MedusaRequest) => string = getClientIp
) {
  /**
   * The actual middleware function
   * 
   * Middleware in Express/Medusa follows this pattern:
   * 1. Do some work (check rate limit)
   * 2. Either:
   *    - Call next() to continue to next middleware/handler
   *    - Send a response (res.status().json()) to stop the chain
   * 
   * @param req - Request object
   * @param res - Response object
   * @param next - Function to call next middleware
   */
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      // Extract identifier (IP address, email, etc.)
      const identifier = getIdentifier(req);
      
      // Check if request is allowed
      const result = await rateLimiter.checkLimit(identifier);
      
      if (!result.allowed) {
        /**
         * Rate limit exceeded - return 429 response
         * 
         * HTTP 429 Too Many Requests:
         * - Standard status code for rate limiting (RFC 6585)
         * - Clients should respect this and back off
         * - Retry-After header tells them when to retry
         */
        
        // Set Retry-After header (in seconds)
        // This is a standard HTTP header that clients can read
        res.setHeader('Retry-After', result.retryAfter.toString());
        
        // Return error response
        return res.status(429).json({
          error: {
            type: 'rate_limit_exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Please try again in ${result.retryAfter} seconds.`,
            retryAfter: result.retryAfter,
          },
        });
      }
      
      /**
       * Request is allowed - increment counter and continue
       * 
       * We increment AFTER checking to avoid counting blocked requests.
       * 
       * We don't await incrementCounter() because:
       * - We already know the request is allowed
       * - Waiting would slow down the response
       * - If increment fails, it's not critical (just means count might be off by 1)
       * 
       * This is called "fire and forget" - we start the operation but don't wait for it.
       */
      rateLimiter.incrementCounter(identifier).catch(err => {
        // Log error but don't fail the request
        console.error('Failed to increment rate limit counter:', err);
      });
      
      // Continue to next middleware/handler
      next();
      
    } catch (error) {
      /**
       * Error handling
       * 
       * If something goes wrong (Redis down, etc.), we have two choices:
       * 
       * 1. Fail open: Allow the request (current implementation)
       *    - Pros: Service stays available during Redis outage
       *    - Cons: No rate limiting during outage (security risk)
       * 
       * 2. Fail closed: Block the request
       *    - Pros: Maintains security even during outage
       *    - Cons: Service becomes unavailable
       * 
       * We fail open because availability is usually more important than
       * perfect rate limiting. Adjust based on your security requirements.
       */
      console.error('Rate limit middleware error:', error);
      
      // Allow request to proceed despite error
      next();
    }
  };
}

/**
 * Rate limit by email address
 * 
 * Use this for endpoints where you want to limit per email, not per IP.
 * Example: Password reset (prevent spamming a specific email)
 * 
 * @param req - Request object
 * @returns Email address from request body
 */
export function getEmailIdentifier(req: MedusaRequest): string {
  // Extract email from request body
  const email = req.body?.email;
  
  if (!email || typeof email !== 'string') {
    // If no email, fall back to IP address
    // This prevents errors but still provides some rate limiting
    return getClientIp(req);
  }
  
  // Normalize email (lowercase, trim whitespace)
  // This prevents bypassing rate limit with "User@Example.com" vs "user@example.com"
  return email.toLowerCase().trim();
}

/**
 * Pre-configured middleware for common endpoints
 * 
 * Import these directly in your routes for convenience.
 */

import {
  loginRateLimiter,
  registrationRateLimiter,
  passwordResetRateLimiter,
} from '../../lib/rate-limiter';

/**
 * Login rate limiting: 5 requests per 15 minutes per IP
 * 
 * Why per IP?
 * - Prevents attacker from trying many passwords on one account
 * - Prevents attacker from trying one password on many accounts
 * - Works for anonymous users (before login)
 */
export const loginRateLimit = createRateLimitMiddleware(loginRateLimiter);

/**
 * Registration rate limiting: 3 requests per hour per IP
 * 
 * Why per IP?
 * - Prevents mass account creation (spam, fraud)
 * - Stricter than login (registration is less frequent)
 */
export const registrationRateLimit = createRateLimitMiddleware(registrationRateLimiter);

/**
 * Password reset rate limiting: 3 requests per hour per email
 * 
 * Why per email?
 * - Prevents spamming a specific user with reset emails
 * - Per-IP would allow attacker to spam from different IPs
 * - Email is the target, so we protect per email
 */
export const passwordResetRateLimit = createRateLimitMiddleware(
  passwordResetRateLimiter,
  getEmailIdentifier
);
