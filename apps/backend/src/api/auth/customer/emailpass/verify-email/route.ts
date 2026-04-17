/**
 * Email Verification Endpoint
 * 
 * This endpoint completes the email verification flow by validating a token
 * and marking the customer's email as verified.
 * 
 * === WHY EMAIL VERIFICATION? ===
 * 
 * Email verification serves multiple important purposes:
 * 
 * 1. Security
 *    - Confirms the user owns the email address
 *    - Prevents account takeover via fake email registration
 *    - Reduces spam and bot accounts
 * 
 * 2. Communication
 *    - Ensures we can send important notifications
 *    - Reduces bounce rates for transactional emails
 *    - Improves email deliverability (fewer spam complaints)
 * 
 * 3. Account Recovery
 *    - Verified email is needed for password reset
 *    - Provides a trusted recovery channel
 * 
 * === EMAIL VERIFICATION FLOW ===
 * 
 * Step 1: User registers (Task 9.3)
 *   - User creates account with email/password
 *   - System generates email verification token
 *   - System sends email with verification link
 *   - User can login but email_verified = false
 * 
 * Step 2: User receives email
 *   - Email contains link: https://yoursite.com/verify-email?token=abc123
 *   - Link expires in 24 hours (longer than password reset)
 *   - Email includes "Didn't sign up? Ignore this email"
 * 
 * Step 3: User clicks link (this endpoint)
 *   - Frontend extracts token from URL
 *   - Frontend sends token to this endpoint
 *   - Backend validates token
 *   - Backend marks email as verified
 *   - Backend consumes token (single-use)
 *   - User is redirected to account page
 * 
 * Step 4: Resend if needed (Task 9.2)
 *   - If user didn't receive email, they can request resend
 *   - Rate limited to 3 per hour (prevent abuse)
 * 
 * === TOKEN SECURITY ===
 * 
 * Email verification tokens are:
 * - Cryptographically random (32 bytes = 256 bits)
 * - Hashed before storage (bcrypt)
 * - Time-limited (24 hours expiration)
 * - Single-use (marked as used after verification)
 * 
 * Why 24 hours instead of 1 hour?
 * - Users might not check email immediately
 * - Less urgent than password reset
 * - Better user experience (less frustration)
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 3.4: Mark email as verified when valid token submitted
 * - Requirement 2.4: Single-use token enforcement (via TokenService)
 * - Requirement 2.6: Token validation (exists, not expired, not used)
 * - Requirement 14.5: Audit logging for email verification
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TokenService } from "../../../../../lib/token-service";
import { createAuditLogger } from "../../../../../lib/audit-logger";

/**
 * Request body validation
 * 
 * We expect a simple JSON body with just the verification token.
 * The token comes from the email link query parameter.
 */
interface VerifyEmailRequestBody {
  token: string;
}

/**
 * POST /auth/customer/emailpass/verify-email
 * 
 * Verify email address with token.
 * 
 * Request Body:
 * {
 *   "token": "abc123..."
 * }
 * 
 * Response (200 OK):
 * {
 *   "message": "Email verified successfully"
 * }
 * 
 * Errors:
 * - 400 Bad Request: Missing token
 * - 400 Bad Request: Invalid, expired, or already used token
 * - 500 Internal Server Error: Server error
 */
export async function POST(
  req: MedusaRequest<VerifyEmailRequestBody>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger");

  try {
    // ============================================================================
    // STEP 1: VALIDATE INPUT
    // ============================================================================

    /**
     * Extract and validate token from request body
     * 
     * The token is a long random string (base64url encoded).
     * We just need to check it's present - TokenService will validate format.
     */
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "MISSING_TOKEN",
          message: "Verification token is required",
        },
      });
      return;
    }

    // Trim whitespace (user might have copied with extra spaces)
    const trimmedToken = token.trim();

    if (trimmedToken.length === 0) {
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "INVALID_TOKEN",
          message: "Verification token cannot be empty",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 2: VALIDATE TOKEN
    // ============================================================================

    /**
     * Token Validation Process
     * 
     * TokenService.validateEmailVerificationToken() checks:
     * 1. Token exists in database (hash matches)
     * 2. Token type is 'email_verification'
     * 3. Token hasn't expired (< 24 hours old)
     * 4. Token hasn't been used (used = false)
     * 
     * If any check fails, it returns null.
     * 
     * Why use TokenService instead of direct database query?
     * - Encapsulation: All token logic in one place
     * - Security: Proper hash comparison (constant-time)
     * - Consistency: Same validation logic everywhere
     * - Testability: Easy to mock in tests
     */

    // Create database adapter for TokenService
    const query = req.scope.resolve("query");

    const tokenDb = {
      /**
       * Find token by hash
       * 
       * We need to hash the raw token and search for it in the database.
       * This is secure because we never store raw tokens.
       */
      async findTokenByHash(tokenHash: string) {
        let tokens: any;

        try {
          tokens = await query.graph({
            entity: "auth_token",
            fields: [
              "id",
              "type",
              "customer_id",
              "email",
              "token_hash",
              "used",
              "created_at",
              "expires_at",
            ],
            filters: { token_hash: tokenHash },
          });
        } catch {
          return null;
        }

        const rows = Array.isArray(tokens) ? tokens : tokens?.data ?? [];
        const tokenData = rows[0];
        if (!tokenData) return null;

        return {
          id: tokenData.id,
          type: tokenData.type,
          customerId: tokenData.customer_id,
          email: tokenData.email,
          tokenHash: tokenData.token_hash,
          used: tokenData.used,
          createdAt: new Date(tokenData.created_at),
          expiresAt: new Date(tokenData.expires_at),
        };
      },

      /**
       * Mark token as used
       * 
       * After successful verification, we mark the token as used.
       * This prevents the same token from being used twice.
       */
      async markTokenAsUsed(id: string) {
        const manager = req.scope.resolve("manager");
        await manager.update("auth_token", id, {
          used: true,
        });
      },

      // Other methods (not used in this endpoint)
      async createToken() {
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

    // Validate the token
    const validToken = await tokenService.validateEmailVerificationToken(
      trimmedToken
    );

    if (!validToken) {
      /**
       * Token validation failed
       * 
       * Possible reasons:
       * - Token doesn't exist (wrong token)
       * - Token has expired (> 24 hours old)
       * - Token has already been used
       * - Token hash doesn't match
       * 
       * We return a generic error message for security:
       * - Don't reveal which specific check failed
       * - Prevents attackers from learning about our system
       * - User-friendly message suggests what to do
       */
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "INVALID_TOKEN",
          message:
            "Invalid or expired verification token. Please request a new verification email.",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 3: MARK EMAIL AS VERIFIED
    // ============================================================================

    /**
     * Update customer record
     * 
     * We set email_verified = true in the customers table.
     * 
     * Why check if customer exists?
     * - Token might be for a deleted account
     * - Defensive programming (handle edge cases)
     * - Better error message for user
     */

    if (!validToken.customerId) {
      /**
       * No customer ID in token
       * 
       * This shouldn't happen in normal flow, but we handle it gracefully.
       * Email verification tokens should always have a customer ID.
       */
      logger.error(
        `Email verification token ${validToken.id} has no customer ID`
      );

      res.status(400).json({
        error: {
          type: "validation_error",
          code: "INVALID_TOKEN",
          message: "Invalid verification token",
        },
      });
      return;
    }

    // Look up the customer
    const customers = await query.graph({
      entity: "customer",
      fields: ["id", "email", "email_verified"],
      filters: { id: validToken.customerId },
    });

    const customer = customers[0];

    if (!customer) {
      /**
       * Customer not found
       * 
       * The account might have been deleted after the token was generated.
       * This is rare but possible.
       */
      logger.warn(
        `Customer ${validToken.customerId} not found for email verification`
      );

      res.status(400).json({
        error: {
          type: "validation_error",
          code: "CUSTOMER_NOT_FOUND",
          message: "Account not found. Please contact support.",
        },
      });
      return;
    }

    // Check if email is already verified
    if (customer.email_verified) {
      /**
       * Email already verified
       * 
       * This can happen if:
       * - User clicks verification link twice
       * - User verifies via different method
       * 
       * We still return success (idempotent operation).
       * The goal is "email is verified" - if it already is, that's fine!
       * 
       * We also consume the token to prevent reuse.
       */
      logger.info(
        `Email already verified for customer ${customer.id}, consuming token anyway`
      );

      // Consume the token
      await tokenService.consumeToken(validToken.id);

      res.status(200).json({
        message: "Email verified successfully",
      });
      return;
    }

    // Update customer record to mark email as verified
    const manager = req.scope.resolve("manager");

    await manager.update("customer", customer.id, {
      email_verified: true,
    });

    logger.info(`Email verified for customer ${customer.id}`);

    // ============================================================================
    // STEP 4: CONSUME TOKEN
    // ============================================================================

    /**
     * Mark token as used
     * 
     * This prevents the token from being used again.
     * 
     * Why mark as used instead of deleting?
     * - Audit trail: We can see when tokens were used
     * - Security: Detect if someone tries to reuse a token
     * - Debugging: Investigate issues with verification flow
     */
    await tokenService.consumeToken(validToken.id);

    // ============================================================================
    // STEP 5: LOG AUDIT EVENT
    // ============================================================================

    /**
     * Audit Logging
     * 
     * We log the email verification event for:
     * - Security monitoring: Track verification patterns
     * - Compliance: Many regulations require audit trails
     * - Analytics: Measure verification rates
     * - Debugging: Investigate user issues
     * 
     * What we log:
     * - Event type: email_verification
     * - Customer ID: Who verified their email
     * - Email: Which email was verified
     * - IP address: Where the request came from
     * - User agent: What browser/device was used
     * - Timestamp: When it happened (automatic)
     */
    const auditLogger = createAuditLogger(manager);
    await auditLogger.logEmailVerification({
      customerId: customer.id,
      email: customer.email,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"],
    });

    // ============================================================================
    // STEP 6: RETURN SUCCESS RESPONSE
    // ============================================================================

    /**
     * Success Response
     * 
     * Simple success message confirming email verification.
     * 
     * Frontend will typically:
     * - Display success message
     * - Redirect to account page
     * - Update UI to show verified status
     * - Remove verification banner
     */
    res.status(200).json({
      message: "Email verified successfully",
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
    logger.error("Error in email verification:", error);

    res.status(500).json({
      error: {
        type: "server_error",
        code: "INTERNAL_ERROR",
        message:
          "An error occurred while verifying your email. Please try again later.",
      },
    });
  }
}
