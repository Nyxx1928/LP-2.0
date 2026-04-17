/**
 * Resend Email Verification Endpoint
 * 
 * This endpoint allows authenticated users to request a new email verification email.
 * 
 * === WHY RESEND VERIFICATION? ===
 * 
 * Users might need to resend verification for several reasons:
 * 
 * 1. Email Never Arrived
 *    - Caught by spam filter
 *    - Typo in email address (rare, but possible)
 *    - Email service temporary failure
 * 
 * 2. Email Was Deleted
 *    - User accidentally deleted it
 *    - Email client auto-cleanup
 * 
 * 3. Link Expired
 *    - Verification links expire after 24 hours
 *    - User didn't check email in time
 * 
 * 4. User Wants Fresh Link
 *    - Lost the original email
 *    - Wants to verify from different device
 * 
 * === SECURITY CONSIDERATIONS ===
 * 
 * 1. Authentication Required
 *    Problem: Without auth, anyone could spam verification emails to any address
 *    Solution: User must be logged in to resend
 *    - Proves they have access to the account
 *    - Prevents email bombing attacks
 *    - Limits abuse to registered users only
 * 
 * 2. Rate Limiting (3 per hour)
 *    Problem: User could spam their own inbox or waste email quota
 *    Solution: Limit to 3 requests per hour per customer
 *    - Legitimate users rarely need more than 1-2 attempts
 *    - Prevents accidental button mashing
 *    - Protects email service costs
 * 
 * 3. Check If Already Verified
 *    Problem: Wasting resources sending emails to verified accounts
 *    Solution: Return success but don't send email if already verified
 *    - Better user experience (no confusing emails)
 *    - Saves email quota
 *    - Prevents confusion
 * 
 * === FLOW COMPARISON ===
 * 
 * Initial Registration Flow (Task 9.3):
 * 1. User registers → System generates token → Email sent automatically
 * 2. User is NOT authenticated yet (just created account)
 * 3. No rate limiting needed (registration itself is rate limited)
 * 
 * Resend Verification Flow (This Endpoint):
 * 1. User is already logged in (authenticated)
 * 2. User clicks "Resend Verification Email" button
 * 3. System checks rate limit
 * 4. System generates NEW token (old one might be expired)
 * 5. Email sent with new verification link
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 3.5: Allow customers to resend verification email
 * - Requirement 3.6: Rate limit to 3 requests per hour per customer
 * - Requirement 3.1: Generate email verification token
 * - Requirement 3.2: Send verification email within 30 seconds (Phase 3)
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TokenService } from "../../../../../lib/token-service";
import { RateLimiter } from "../../../../../lib/rate-limiter";

/**
 * Rate limiter for email verification resend
 * 
 * Configuration:
 * - Window: 1 hour (60 * 60 * 1000 ms)
 * - Max requests: 3
 * - Key prefix: "resend_verification"
 * 
 * Why 3 per hour?
 * - Legitimate users: 1-2 attempts is usually enough
 * - Prevents abuse: Can't spam inbox
 * - Reasonable UX: Not too restrictive
 */
const resendVerificationRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  keyPrefix: "resend_verification",
});

/**
 * POST /auth/customer/emailpass/resend-verification
 * 
 * Resend email verification email to authenticated user.
 * 
 * Authentication: REQUIRED (user must be logged in)
 * 
 * Request Body: None (we get email from authenticated session)
 * 
 * Response (200 OK):
 * {
 *   "message": "Verification email sent"
 * }
 * 
 * Errors:
 * - 401 Unauthorized: Not logged in
 * - 429 Too Many Requests: Rate limit exceeded (3 per hour)
 * - 500 Internal Server Error: Server error
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger");

  try {
    // ============================================================================
    // STEP 1: VERIFY AUTHENTICATION
    // ============================================================================

    /**
     * Check if user is authenticated
     * 
     * In Medusa, authenticated requests have:
     * - req.auth_context.actor_id: The customer ID
     * - req.auth_context.actor_type: Should be "customer"
     * 
     * Why require authentication?
     * - Prevents anyone from sending verification emails to any address
     * - Proves the requester has access to the account
     * - Limits abuse to registered users only
     * 
     * How authentication works:
     * 1. User logs in → Gets JWT token in HTTP-only cookie
     * 2. Browser sends cookie with every request
     * 3. Medusa middleware validates JWT and sets auth_context
     * 4. We check auth_context to see if user is logged in
     */

    const customerId = req.auth_context?.actor_id;
    const actorType = req.auth_context?.actor_type;

    if (!customerId || actorType !== "customer") {
      /**
       * Not authenticated
       * 
       * This means:
       * - No JWT token in cookie, OR
       * - JWT token is invalid/expired, OR
       * - JWT token is for admin, not customer
       * 
       * We return 401 Unauthorized with a clear message.
       */
      res.status(401).json({
        error: {
          type: "authentication_error",
          code: "NOT_AUTHENTICATED",
          message: "You must be logged in to resend verification email",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 2: LOOK UP CUSTOMER
    // ============================================================================

    /**
     * Fetch customer data from database
     * 
     * We need to:
     * 1. Get the customer's email address (to send verification email)
     * 2. Check if email is already verified (no need to resend)
     * 3. Verify the customer exists (defensive programming)
     */

    const query = req.scope.resolve("query");

    const customers = await query.graph({
      entity: "customer",
      fields: ["id", "email", "email_verified", "first_name", "last_name"],
      filters: { id: customerId },
    });

    const customer = customers.data?.[0];

    if (!customer) {
      /**
       * Customer not found
       * 
       * This shouldn't happen in normal flow (auth_context has valid ID).
       * But we handle it gracefully for edge cases:
       * - Customer was deleted after login
       * - Database inconsistency
       * 
       * We return 401 because the session is invalid.
       */
      logger.error(
        `Customer ${customerId} not found but has valid auth context`
      );

      res.status(401).json({
        error: {
          type: "authentication_error",
          code: "CUSTOMER_NOT_FOUND",
          message: "Account not found. Please log in again.",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 3: CHECK IF ALREADY VERIFIED
    // ============================================================================

    /**
     * Skip if email is already verified
     * 
     * Why check this?
     * - No point sending verification email to verified account
     * - Saves email quota
     * - Better UX (no confusing emails)
     * 
     * We still return success (idempotent operation):
     * - Goal: "Email is verified"
     * - If already verified, goal achieved!
     * - User doesn't need to know we skipped sending
     */

    if (customer.email_verified) {
      logger.info(
        `Resend verification requested for already verified email: ${customer.email}`
      );

      res.status(200).json({
        message: "Verification email sent",
      });
      return;
    }

    // ============================================================================
    // STEP 4: CHECK RATE LIMIT
    // ============================================================================

    /**
     * Rate Limiting Strategy
     * 
     * We rate limit by customer ID, not IP address. Why?
     * 
     * Customer ID is better because:
     * - Protects specific accounts from spam
     * - Prevents inbox flooding
     * - Can't be bypassed by changing IP
     * - User is authenticated, so we know who they are
     * 
     * Limit: 3 requests per hour per customer
     * - Legitimate users rarely need more than 1-2 attempts
     * - Prevents accidental button mashing
     * - Protects email service costs
     */

    const rateLimitResult = await resendVerificationRateLimiter.checkLimit(
      customerId
    );

    if (!rateLimitResult.allowed) {
      /**
       * Rate limit exceeded
       * 
       * User has requested too many verification emails.
       * 
       * We return 429 Too Many Requests with:
       * - Clear error message
       * - Retry-After header (HTTP standard)
       * - retryAfter in response body (for frontend)
       * 
       * Frontend can use this to:
       * - Disable the "Resend" button
       * - Show countdown timer: "Try again in 45 minutes"
       * - Provide better UX than generic error
       */
      res.status(429).json({
        error: {
          type: "rate_limit_error",
          code: "TOO_MANY_REQUESTS",
          message:
            "Too many verification email requests. Please try again later.",
          retryAfter: rateLimitResult.retryAfter,
        },
      });

      // Set Retry-After header (HTTP standard)
      // Browsers and HTTP clients can use this automatically
      res.setHeader("Retry-After", rateLimitResult.retryAfter.toString());

      return;
    }

    // Increment rate limit counter
    // We do this AFTER checking the limit to avoid counting rejected requests
    await resendVerificationRateLimiter.incrementCounter(customerId);

    // ============================================================================
    // STEP 5: GENERATE NEW VERIFICATION TOKEN
    // ============================================================================

    /**
     * Token Generation Process
     * 
     * We generate a NEW token, not reuse the old one. Why?
     * 
     * 1. Old token might be expired (24 hours)
     * 2. Old token might have been used already
     * 3. Fresh token is simpler than checking old token status
     * 4. Each resend gets a unique token (better audit trail)
     * 
     * Token properties:
     * - Type: 'email_verification'
     * - Expiration: 24 hours from now
     * - Single-use: Can only be used once
     * - Cryptographically secure: 32 bytes of randomness
     */

    // Create database adapter for TokenService
    const manager = req.scope.resolve("manager");

    const tokenDb = {
      /**
       * Create a new token in the database
       * 
       * We store:
       * - Token hash (NOT the raw token - security!)
       * - Customer ID (who the token is for)
       * - Email (which email to verify)
       * - Type (email_verification)
       * - Expiration (24 hours from now)
       * - Used flag (false initially)
       */
      async createToken(tokenData: any) {
        const id = `token_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;

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
      async findTokenByHash() {
        throw new Error("Not implemented");
      },
      async markTokenAsUsed() {
        throw new Error("Not implemented");
      },
      async deleteExpiredTokens() {
        throw new Error("Not implemented");
      },
      async countRecentTokens() {
        throw new Error("Not implemented");
      },
    };

    // Create TokenService instance
    const tokenService = new TokenService(tokenDb as any);

    // Generate the verification token
    const verificationToken =
      await tokenService.generateEmailVerificationToken(
        customer.email,
        customer.id
      );

    /**
     * TODO: Send verification email (Phase 3)
     * 
     * In Phase 3, we'll integrate with an email service (Resend) to send
     * the verification email. For now, we just log the token.
     * 
     * Email will contain:
     * - Verification link: https://yoursite.com/verify-email?token={verificationToken}
     * - Expiration time: 24 hours
     * - Customer's name (if available)
     * - Instructions: "Click the link to verify your email"
     * 
     * Example email service call:
     * ```typescript
     * await emailService.sendEmailVerification(
     *   customer.email,
     *   customer.first_name || 'Customer',
     *   verificationToken
     * );
     * ```
     */

    logger.info(
      `Email verification token generated for ${customer.email}. ` +
        `Token: ${verificationToken} (This should be sent via email, not logged in production!)`
    );

    // ============================================================================
    // STEP 6: RETURN SUCCESS RESPONSE
    // ============================================================================

    /**
     * Success Response
     * 
     * Simple success message confirming email was sent.
     * 
     * We don't include the token in the response because:
     * - Token should only be sent via email (security)
     * - Including it in response defeats the purpose of email verification
     * - User should check their email, not copy from API response
     * 
     * Frontend will typically:
     * - Display success toast: "Verification email sent!"
     * - Show message: "Check your inbox for verification link"
     * - Disable "Resend" button temporarily
     * - Maybe show countdown: "You can resend in 1 hour"
     */

    res.status(200).json({
      message: "Verification email sent",
    });
  } catch (error) {
    /**
     * Error Handling
     * 
     * If something goes wrong (database error, Redis error, etc.), we:
     * 1. Log the error for debugging
     * 2. Return a generic error message (don't expose internals)
     * 3. Return 500 Internal Server Error
     * 
     * Why generic error message?
     * - Don't reveal internal implementation details
     * - Don't help attackers understand our system
     * - Provide enough info for user to contact support
     * 
     * Common errors:
     * - Database connection failure
     * - Redis connection failure (rate limiter)
     * - Token generation failure
     * - Email service failure (Phase 3)
     */
    logger.error("Error in resend verification:", error);

    res.status(500).json({
      error: {
        type: "server_error",
        code: "INTERNAL_ERROR",
        message:
          "An error occurred while sending verification email. Please try again later.",
      },
    });
  }
}
