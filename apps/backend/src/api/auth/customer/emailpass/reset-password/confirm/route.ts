/**
 * Password Reset Confirmation Endpoint
 * 
 * This endpoint completes the password reset flow by validating the reset token
 * and updating the customer's password.
 * 
 * === SECURITY CONSIDERATIONS ===
 * 
 * 1. Token Validation
 *    We must verify:
 *    - Token exists in database
 *    - Token hasn't expired (1 hour limit)
 *    - Token hasn't been used already (single-use)
 *    - Token hash matches (prevents tampering)
 *    
 *    Why single-use?
 *    - If someone intercepts the email, they can only use it once
 *    - After password is reset, the token becomes useless
 *    - Prevents replay attacks
 * 
 * 2. Password Validation
 *    We enforce strong password requirements:
 *    - Minimum 12 characters
 *    - Must contain uppercase, lowercase, number, special character
 *    - Not in common password list
 *    - Doesn't contain user's email
 *    
 *    Why so strict?
 *    - Weak passwords are the #1 cause of account breaches
 *    - Users often choose weak passwords if allowed
 *    - Better to enforce security than deal with breaches
 * 
 * 3. Session Invalidation
 *    After password reset, we invalidate ALL sessions.
 *    
 *    Why?
 *    - If attacker had access to account, they're now logged out
 *    - User must re-login with new password
 *    - Prevents session hijacking
 *    
 *    Note: We don't keep the current session because:
 *    - This is a password reset (user isn't logged in yet)
 *    - They'll login with new password after reset
 * 
 * === PASSWORD RESET FLOW (PART 2) ===
 * 
 * Step 1: User requests reset (previous endpoint)
 *   - User enters email
 *   - System generates token
 *   - System sends email with reset link
 * 
 * Step 2: User receives email
 *   - Email contains link: https://yoursite.com/reset-password?token=abc123
 *   - User clicks link
 * 
 * Step 3: User enters new password (THIS ENDPOINT)
 *   - Frontend sends token + new password
 *   - We validate token
 *   - We validate password strength
 *   - We update password
 *   - We invalidate all sessions
 *   - User can now login with new password
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 2.4: Single-use token enforcement
 * - Requirement 2.5: Validate token and update password
 * - Requirement 2.6: Reject expired/invalid tokens
 * - Requirement 4.7: Invalidate all sessions on password change
 * - Requirement 14.5: Log password reset completion
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TokenService } from "../../../../../../lib/token-service";
import { PasswordValidator } from "../../../../../../lib/password-validator";
import { SessionManager } from "../../../../../../lib/session-manager";
import { createAuditLogger } from "../../../../../../lib/audit-logger";
import bcrypt from "bcrypt";

/**
 * Request body validation
 * 
 * We expect:
 * - token: The reset token from the email link
 * - password: The new password the user wants to set
 */
interface ResetPasswordConfirmBody {
  token: string;
  password: string;
}

/**
 * POST /auth/customer/emailpass/reset-password/confirm
 * 
 * Complete password reset with token and new password.
 * 
 * Request Body:
 * {
 *   "token": "abc123...",
 *   "password": "NewSecurePassword123!"
 * }
 * 
 * Response (200 OK):
 * {
 *   "message": "Password reset successfully"
 * }
 * 
 * Errors:
 * - 400 Bad Request: Missing token/password, invalid token, weak password
 * - 500 Internal Server Error: Server error
 */
export async function POST(
  req: MedusaRequest<ResetPasswordConfirmBody>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger");

  try {
    // ============================================================================
    // STEP 1: VALIDATE INPUT
    // ============================================================================

    /**
     * Extract and validate request body
     * 
     * We need both token and password to proceed.
     */
    const { token, password } = req.body;

    if (!token || typeof token !== "string") {
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "MISSING_TOKEN",
          message: "Reset token is required",
        },
      });
      return;
    }

    if (!password || typeof password !== "string") {
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "MISSING_PASSWORD",
          message: "New password is required",
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
     * The TokenService will check:
     * 1. Token exists in database (by comparing hashes)
     * 2. Token is of type 'password_reset'
     * 3. Token hasn't expired (< 1 hour old)
     * 4. Token hasn't been used already
     * 
     * If any check fails, we return null.
     */

    // Create database adapter for TokenService
    const query = req.scope.resolve("query");

    const tokenDb = {
      async createToken() {
        throw new Error("Not implemented");
      },

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
        const token = rows[0];
        if (!token) return null;

        return {
          id: token.id,
          type: token.type,
          customerId: token.customer_id,
          email: token.email,
          tokenHash: token.token_hash,
          used: token.used,
          createdAt: new Date(token.created_at),
          expiresAt: new Date(token.expires_at),
        };
      },

      async markTokenAsUsed(id: string) {
        const manager = req.scope.resolve("manager");
        await manager.update("auth_token", id, {
          used: true,
        });
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
    const validToken = await tokenService.validatePasswordResetToken(token);

    if (!validToken) {
      /**
       * Token is invalid
       * 
       * This could mean:
       * - Token doesn't exist (wrong token)
       * - Token has expired (> 1 hour old)
       * - Token has been used already
       * - Token hash doesn't match (tampered)
       * 
       * We return a generic error message for security:
       * - Don't reveal which specific check failed
       * - Prevents attackers from learning about our system
       */
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "INVALID_TOKEN",
          message:
            "Invalid or expired reset token. Please request a new password reset.",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 3: VALIDATE NEW PASSWORD
    // ============================================================================

    /**
     * Password Strength Validation
     * 
     * We use the PasswordValidator service to check:
     * - Length (minimum 12 characters)
     * - Character classes (uppercase, lowercase, number, special)
     * - Not in common password list
     * - Doesn't contain user's email
     * 
     * Why validate?
     * - Weak passwords are easily cracked
     * - Users often choose weak passwords if allowed
     * - Better to enforce security than deal with breaches
     */

    const passwordValidator = new PasswordValidator();
    const validationResult = passwordValidator.validate(
      password,
      validToken.email
    );

    if (!validationResult.valid) {
      /**
       * Password is too weak
       * 
       * We return specific error messages so the user knows what to fix.
       * This is OK because it's not a security risk - we're helping the user
       * create a strong password.
       */
      res.status(400).json({
        error: {
          type: "validation_error",
          code: "WEAK_PASSWORD",
          message: "Password does not meet security requirements",
          details: {
            errors: validationResult.errors,
            strength: validationResult.strength,
          },
        },
      });
      return;
    }

    // ============================================================================
    // STEP 4: LOOK UP CUSTOMER
    // ============================================================================

    /**
     * Find the customer by email
     * 
     * We need the customer record to:
     * 1. Update their password
     * 2. Invalidate their sessions
     * 3. Log the audit event
     */

    const customers = await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email: validToken.email },
    });

    const customer = customers[0];

    if (!customer) {
      /**
       * Customer doesn't exist
       * 
       * This shouldn't happen because:
       * - We only generate tokens for existing customers
       * - Token is linked to an email
       * 
       * But if it does happen (e.g., customer was deleted), we handle it gracefully.
       */
      logger.error(
        `Password reset token exists for non-existent customer: ${validToken.email}`
      );

      res.status(400).json({
        error: {
          type: "validation_error",
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer account not found. Please contact support.",
        },
      });
      return;
    }

    // ============================================================================
    // STEP 5: UPDATE PASSWORD
    // ============================================================================

    /**
     * Hash and Update Password
     * 
     * We use bcrypt to hash the password before storing it.
     * 
     * Why bcrypt?
     * - Designed specifically for password hashing
     * - Slow by design (prevents brute force attacks)
     * - Includes salt automatically (prevents rainbow table attacks)
     * - Industry standard (used by most major platforms)
     * 
     * Cost factor: 12
     * - Higher = more secure but slower
     * - 12 is a good balance (recommended by OWASP)
     * - Takes ~250ms to hash (acceptable for password reset)
     */

    const manager = req.scope.resolve("manager");

    const passwordHash = await bcrypt.hash(password, 12);

    await manager.update("customer", customer.id, {
      password_hash: passwordHash,
    });

    logger.info(`Password updated for customer: ${customer.email}`);

    // ============================================================================
    // STEP 6: CONSUME TOKEN
    // ============================================================================

    /**
     * Mark Token as Used
     * 
     * This prevents the token from being reused.
     * 
     * Why not delete it?
     * - Audit trail: We can see when tokens were used
     * - Security: Detect if someone tries to reuse a token
     * - Debugging: Investigate user issues
     */

    await tokenService.consumeToken(validToken.id);

    logger.info(`Password reset token consumed: ${validToken.id}`);

    // ============================================================================
    // STEP 7: INVALIDATE ALL SESSIONS
    // ============================================================================

    /**
     * Invalidate All Sessions
     * 
     * After password reset, we log the user out of all devices.
     * 
     * Why?
     * - If attacker had access, they're now logged out
     * - User must re-login with new password
     * - Prevents session hijacking
     * 
     * Note: We don't keep any session because this is a password reset
     * (user isn't logged in). They'll login with new password after reset.
     */

    // Create database adapter for SessionManager
    const sessionDb = {
      async createSession() {
        throw new Error("Not implemented");
      },
      async findSessionByTokenHash() {
        throw new Error("Not implemented");
      },
      async findSessionById() {
        throw new Error("Not implemented");
      },
      async updateLastActivity() {
        throw new Error("Not implemented");
      },
      async deleteSession() {
        throw new Error("Not implemented");
      },

      async deleteAllSessionsExcept(customerId: string): Promise<number> {
        // Find all sessions for this customer
        const sessions = await query.graph({
          entity: "session",
          fields: ["id"],
          filters: { customer_id: customerId },
        });

        // Delete all sessions
        for (const session of sessions) {
          await manager.delete("session", session.id);
        }

        return sessions.length;
      },

      async listActiveSessions() {
        throw new Error("Not implemented");
      },
      async deleteExpiredSessions() {
        throw new Error("Not implemented");
      },
    };

    // Create SessionManager instance
    // Note: We need a JWT secret, but we're only using deleteAllSessionsExcept
    // which doesn't need it. We'll use a dummy value.
    const jwtSecret = process.env.JWT_SECRET || "dummy-secret-for-deletion";
    const sessionManager = new SessionManager(sessionDb as any, jwtSecret);

    // Invalidate all sessions (no exception - user isn't logged in)
    const sessionsInvalidated = await sessionManager.invalidateAllSessions(
      customer.id
    );

    logger.info(
      `Invalidated ${sessionsInvalidated} sessions for customer: ${customer.email}`
    );

    // ============================================================================
    // STEP 8: LOG AUDIT EVENT
    // ============================================================================

    /**
     * Audit Logging
     * 
     * We log the password reset completion for:
     * - Security monitoring: Track password changes
     * - Compliance: Many regulations require audit trails
     * - Debugging: Investigate user issues
     * 
     * What we log:
     * - Event type: password_reset_complete
     * - Customer ID
     * - Email address
     * - IP address
     * - User agent
     * - Metadata: Sessions invalidated
     */

    const auditLogger = createAuditLogger(manager);
    await auditLogger.logPasswordResetComplete({
      customerId: customer.id,
      email: customer.email,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"],
    });

    // ============================================================================
    // STEP 9: RETURN SUCCESS RESPONSE
    // ============================================================================

    /**
     * Success Response
     * 
     * We return a simple success message.
     * The frontend will typically:
     * 1. Show success message
     * 2. Redirect to login page
     * 3. User logs in with new password
     */

    res.status(200).json({
      message: "Password reset successfully",
    });
  } catch (error) {
    /**
     * Error Handling
     * 
     * If something goes wrong (database error, etc.), we:
     * 1. Log the error for debugging
     * 2. Return a generic error message (don't expose internals)
     * 3. Return 500 Internal Server Error
     */
    logger.error("Error in password reset confirmation:", error);

    res.status(500).json({
      error: {
        type: "server_error",
        code: "INTERNAL_ERROR",
        message:
          "An error occurred while resetting your password. Please try again later.",
      },
    });
  }
}
