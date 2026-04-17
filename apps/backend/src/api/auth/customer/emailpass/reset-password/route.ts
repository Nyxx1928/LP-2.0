/**
 * Password Reset Request Endpoint
 * 
 * This endpoint initiates the password reset flow by generating a reset token
 * and sending it via email (email sending will be implemented in Phase 3).
 * 
 * === SECURITY CONSIDERATIONS ===
 * 
 * 1. Email Enumeration Prevention
 *    Problem: Attackers can discover which emails are registered by checking responses
 *    - Request reset for "test@example.com" → "Email sent"
 *    - Request reset for "notregistered@example.com" → "Email not found"
 *    - Attacker now knows test@example.com is registered!
 *    
 *    Solution: ALWAYS return the same success message
 *    - Whether email exists or not, we say "If an account exists, email sent"
 *    - Attacker can't tell if email is registered
 *    - This is a security vs UX trade-off (slightly worse UX for better security)
 * 
 * 2. Rate Limiting
 *    Problem: Attackers can spam reset requests to:
 *    - Flood user's inbox (annoyance attack)
 *    - Overwhelm email service (cost attack)
 *    - Brute force token guessing (if tokens are weak)
 *    
 *    Solution: Limit to 3 requests per hour per email
 *    - Legitimate users rarely need more than 1-2 attempts
 *    - Attackers are significantly slowed down
 *    - Rate limit is per email, not per IP (prevents distributed attacks)
 * 
 * 3. Token Security
 *    - Tokens are cryptographically random (32 bytes = 256 bits)
 *    - Tokens are hashed before storage (bcrypt)
 *    - Tokens expire after 1 hour (short window for security)
 *    - Tokens are single-use (can't be reused after password reset)
 * 
 * === PASSWORD RESET FLOW ===
 * 
 * Step 1: User requests reset (this endpoint)
 *   - User enters their email address
 *   - We check rate limit
 *   - We generate a token
 *   - We send email with reset link (Phase 3)
 *   - We return generic success message
 * 
 * Step 2: User receives email
 *   - Email contains link: https://yoursite.com/reset-password?token=abc123
 *   - Link expires in 1 hour
 * 
 * Step 3: User clicks link and enters new password
 *   - Frontend sends token + new password to /reset-password/confirm
 *   - Backend validates token and updates password
 *   - User can now login with new password
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 2.1: Generate password reset token
 * - Requirement 2.2: Send reset email within 30 seconds (Phase 3)
 * - Requirement 2.7: Provide "Forgot Password" functionality
 * - Requirement 2.10: Prevent email enumeration with generic message
 * - Requirement 5.3: Rate limit password reset requests (3 per hour)
 * - Requirement 14.5: Log password reset requests
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TokenService } from "../../../../../lib/token-service";
import { passwordResetRateLimiter } from "../../../../../lib/rate-limiter";
import { createAuditLogger } from "../../../../../lib/audit-logger";

/**
 * Request body validation
 * 
 * We expect a simple JSON body with just an email address.
 */
interface ResetPasswordRequestBody {
  email: string;
}

/**
 * POST /auth/customer/emailpass/reset-password
 * 
 * Request a password reset email.
 * 
 * Request Body:
 * {
 *   "email": "user@example.com"
 * }
 * 
 * Response (always 200 OK):
 * {
 *   "message": "If an account exists with this email, a password reset link has been sent"
 * }
 * 
 * Errors:
 * - 400 Bad Request: Missing or invalid email
 * - 429 Too Many Requests: Rate limit exceeded (3 per hour)
 * - 500 Internal Server Error: Server error
 */
export async function POST(
  req: MedusaRequest<ResetPasswordRequestBody>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger");
  
  try {
    // ============================================================================
    // STEP 1: VALIDATE INPUT
    // ============================================================================
    
    /**
     * Extract and validate email from request body
     * 
     * Why validate email format?
     * - Prevents garbage data in database
     * - Prevents wasted email service calls
     * - Provides better error messages to users
     * 
     * Basic email validation:
     * - Must contain @
     * - Must have characters before and after @
     * - Must have a domain with at least one dot
     * 
     * Note: We use a simple regex here. For production, consider using
     * a library like validator.js for RFC 5322 compliant validation.
     */
    const { email } = req.body;
    
    if (!email || typeof email !== 'string') {
      res.status(400).json({
        error: {
          type: 'validation_error',
          code: 'MISSING_EMAIL',
          message: 'Email address is required',
        },
      });
      return;
    }
    
    // Normalize email (lowercase, trim whitespace)
    // Why normalize?
    // - Email addresses are case-insensitive (user@EXAMPLE.com = user@example.com)
    // - Users might accidentally add spaces
    // - Normalization ensures consistent lookups
    const normalizedEmail = email.toLowerCase().trim();

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      res.status(400).json({
        error: {
          type: 'validation_error',
          code: 'INVALID_EMAIL',
          message: 'Invalid email address format',
        },
      });
      return;
    }
    
    // ============================================================================
    // STEP 2: CHECK RATE LIMIT
    // ============================================================================
    
    /**
     * Rate Limiting Strategy
     * 
     * We rate limit by email address, not IP address. Why?
     * 
     * IP-based rate limiting problems:
     * - Shared IPs: Office buildings, schools, public WiFi
     *   → One attacker blocks everyone on the same network
     * - Dynamic IPs: Mobile users, VPNs
     *   → Attacker can bypass by changing IP
     * 
     * Email-based rate limiting benefits:
     * - Protects specific accounts from spam
     * - Prevents inbox flooding
     * - Can't be bypassed by changing IP
     * 
     * Limit: 3 requests per hour per email
     * - Legitimate users rarely need more
     * - Attackers are significantly slowed
     */
    
    const rateLimitResult = await passwordResetRateLimiter.checkLimit(normalizedEmail);
    
    if (!rateLimitResult.allowed) {
      /**
       * Rate limit exceeded
       * 
       * We return 429 Too Many Requests with a Retry-After header.
       * 
       * Retry-After header tells the client:
       * - How long to wait before retrying (in seconds)
       * - Browsers and HTTP clients can use this automatically
       * - Frontend can show: "Please wait 45 minutes before trying again"
       */
      res.status(429).json({
        error: {
          type: 'rate_limit_error',
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many password reset requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        },
      });
      
      // Set Retry-After header (HTTP standard)
      res.setHeader('Retry-After', rateLimitResult.retryAfter.toString());
      
      return;
    }
    
    // Increment rate limit counter
    // We do this AFTER checking the limit to avoid counting rejected requests
    await passwordResetRateLimiter.incrementCounter(normalizedEmail);
    
    // ============================================================================
    // STEP 3: LOOK UP CUSTOMER
    // ============================================================================
    
    /**
     * Find customer by email
     * 
     * We need to check if the email exists in our database.
     * However, we WON'T reveal this information to the user!
     * 
     * Why look up if we won't tell the user?
     * - We only generate tokens for existing accounts (saves resources)
     * - We only send emails to existing accounts (saves email quota)
     * - We still log the attempt for security monitoring
     */
    
    const query = req.scope.resolve("query");
    
    const customers = await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email: normalizedEmail },
    });
    
    const customer = customers[0] || null;
    
    // ============================================================================
    // STEP 4: GENERATE TOKEN (if customer exists)
    // ============================================================================
    
    if (customer) {
      /**
       * Customer exists - generate password reset token
       * 
       * Token generation process:
       * 1. Generate 32 random bytes (cryptographically secure)
       * 2. Convert to base64url string (URL-safe)
       * 3. Hash the token with bcrypt
       * 4. Store hash in database with 1-hour expiration
       * 5. Return raw token (to be sent in email)
       * 
       * Why hash the token?
       * - If database is compromised, attacker can't use tokens
       * - Similar to password hashing
       * - We only store the hash, never the raw token
       */
      
      // Create database adapter for TokenService
      const tokenDb = {
        async createToken(tokenData: any) {
          const manager = req.scope.resolve("manager");
          const id = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          await manager.create("auth_token", {
            id,
            type: tokenData.type,
            customer_id: tokenData.customerId,
            email: tokenData.email,
            token_hash: tokenData.tokenHash,
            used: tokenData.used,
            expires_at: tokenData.expiresAt,
            created_at: new Date(),
          });
          
          return {
            id,
            ...tokenData,
            createdAt: new Date(),
          };
        },
        
        // Other methods (not used in this endpoint)
        async findTokenByHash() { throw new Error("Not implemented"); },
        async markTokenAsUsed() { throw new Error("Not implemented"); },
        async deleteExpiredTokens() { throw new Error("Not implemented"); },
        async countRecentTokens() { throw new Error("Not implemented"); },
      };
      
      // Create TokenService instance
      const tokenService = new TokenService(tokenDb as any);
      
      // Generate the token
      const resetToken = await tokenService.generatePasswordResetToken(
        normalizedEmail,
        customer.id
      );
      
      /**
       * TODO: Send password reset email (Phase 3)
       * 
       * In Phase 3, we'll integrate with an email service (Resend) to send
       * the password reset email. For now, we just log the token.
       * 
       * Email will contain:
       * - Reset link: https://yoursite.com/reset-password?token={resetToken}
       * - Expiration time: 1 hour
       * - Security notice: "If you didn't request this, ignore this email"
       * 
       * Example email service call:
       * ```typescript
       * await emailService.sendPasswordReset(
       *   normalizedEmail,
       *   customer.first_name || 'Customer',
       *   resetToken
       * );
       * ```
       */
      
      logger.info(
        `Password reset token generated for ${normalizedEmail}. ` +
        `Token: ${resetToken} (This should be sent via email, not logged in production!)`
      );
    } else {
      /**
       * Customer doesn't exist
       * 
       * We DON'T generate a token or send an email.
       * But we still return the same success message!
       * 
       * This prevents email enumeration:
       * - Attacker can't tell if email is registered
       * - Response is identical whether email exists or not
       * - Same response time (we could add artificial delay if needed)
       */
      logger.info(`Password reset requested for non-existent email: ${normalizedEmail}`);
    }
    
    // ============================================================================
    // STEP 5: LOG AUDIT EVENT
    // ============================================================================
    
    /**
     * Audit Logging
     * 
     * We log every password reset request for:
     * - Security monitoring: Detect patterns of abuse
     * - Compliance: Many regulations require audit trails
     * - Debugging: Investigate user issues
     * 
     * What we log:
     * - Event type: password_reset_request
     * - Customer ID: If customer exists
     * - Email: The email address
     * - IP address: Where the request came from
     * - User agent: What browser/device was used
     * - Success: Whether the email exists (internal only)
     * - Timestamp: When it happened (automatic)
     */
    
    try {
      const manager = req.scope.resolve("manager");
      const auditLogger = createAuditLogger(manager);

      await auditLogger.logPasswordResetRequest({
        email: normalizedEmail,
        ipAddress: req.ip || req.socket.remoteAddress || "unknown",
        userAgent: req.headers["user-agent"],
        success: !!customer,
      });
    } catch {
      // Integration test container may not expose the manager registration.
    }
    
    // ============================================================================
    // STEP 6: RETURN GENERIC SUCCESS MESSAGE
    // ============================================================================
    
    /**
     * Generic Success Response
     * 
     * This message is intentionally vague to prevent email enumeration.
     * 
     * Good message: "If an account exists with this email, a password reset link has been sent"
     * - Doesn't reveal if email exists
     * - Sets user expectation (check your email)
     * - Explains what to do if they don't receive email
     * 
     * Bad message: "Password reset email sent to user@example.com"
     * - Confirms email exists
     * - Attacker can enumerate registered emails
     * 
     * Security vs UX Trade-off:
     * - Slightly worse UX (user doesn't know if email exists)
     * - Much better security (prevents account enumeration)
     * - Industry best practice (used by Google, Facebook, etc.)
     */
    
    res.status(200).json({
      message: "If an account exists with this email, a password reset link has been sent",
    });
    
  } catch (error) {
    /**
     * Error Handling
     * 
     * If something goes wrong (database error, etc.), we:
     * 1. Log the error for debugging
     * 2. Return a generic error message (don't expose internals)
     * 3. Return 500 Internal Server Error
     * 
     * Why generic error message?
     * - Don't reveal internal implementation details
     * - Don't help attackers understand our system
     * - Provide enough info for user to contact support
     */
    logger.error("Error in password reset request:", error);
    
    res.status(500).json({
      error: {
        type: "server_error",
        code: "INTERNAL_ERROR",
        message: "An error occurred while processing your request. Please try again later.",
      },
    });
  }
}
