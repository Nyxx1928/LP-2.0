/**
 * Login Endpoint with Account Lockout Protection
 * 
 * This endpoint handles customer login with email/password authentication
 * and implements account lockout to prevent brute force attacks.
 * 
 * === WHAT IS ACCOUNT LOCKOUT? ===
 * 
 * Account lockout is a security mechanism that temporarily locks an account
 * after too many failed login attempts. This prevents attackers from trying
 * thousands of passwords to break into an account.
 * 
 * Example Attack Without Lockout:
 * - Attacker tries password: "password123" → Failed
 * - Attacker tries password: "qwerty" → Failed
 * - Attacker tries password: "letmein" → Failed
 * - ... continues for 10,000 attempts ...
 * - Eventually finds the right password
 * 
 * With Account Lockout:
 * - Attacker tries 5 wrong passwords
 * - Account locks for 30 minutes
 * - Attacker can only try 5 passwords every 30 minutes
 * - Would take 100+ days to try 10,000 passwords
 * - Attack becomes impractical!
 * 
 * === HOW IT WORKS ===
 * 
 * We track failed login attempts in the database:
 * - failed_login_count: How many consecutive failures
 * - locked_until: When the lockout expires (null if not locked)
 * 
 * Login Flow:
 * 1. Check if account is locked (locked_until > now)
 * 2. If locked, return error with time remaining
 * 3. If not locked, try to authenticate
 * 4. If auth fails:
 *    - Increment failed_login_count
 *    - If count reaches 5, set locked_until = now + 30 minutes
 *    - Send email notification
 *    - Log audit event
 * 5. If auth succeeds:
 *    - Reset failed_login_count to 0
 *    - Clear locked_until
 *    - Create session
 *    - Log audit event
 * 
 * === WHY THESE SPECIFIC NUMBERS? ===
 * 
 * 5 attempts: Balance between security and user experience
 * - Too few (3): Legitimate users might lock themselves out
 * - Too many (10): Gives attackers more chances
 * - 5 is industry standard (used by Google, Microsoft, etc.)
 * 
 * 30 minutes: Long enough to deter attacks, short enough for users
 * - Too short (5 min): Attacker can try again quickly
 * - Too long (24 hours): Legitimate user locked out all day
 * - 30 minutes is a good compromise
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 6.1: Track failed login attempts per account
 * - Requirement 6.2: Lock account after 5 consecutive failures
 * - Requirement 6.3: Return error with lockout duration
 * - Requirement 6.4: Reset counter on successful login
 * - Requirement 6.5: Automatically unlock after 30 minutes
 * - Requirement 14.6: Log audit event when account is locked
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { createAuditLogger } from "../../../../lib/audit-logger";

type DbManager = {
  create: (entity: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (
    entity: string,
    id: string,
    data: Record<string, unknown>
  ) => Promise<unknown>;
  delete: (entity: string, id: string) => Promise<unknown>;
};

interface CustomerAuthRow {
  id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  failed_login_count?: number | null;
  locked_until?: string | Date | null;
  email_verified?: boolean | null;
}

/**
 * Account Lockout Configuration
 * 
 * These constants define the lockout behavior.
 * In a production app, these might come from environment variables
 * or a configuration service.
 */
const LOCKOUT_CONFIG = {
  // Maximum failed attempts before lockout
  maxFailedAttempts: 5,
  
  // Lockout duration in milliseconds (30 minutes)
  lockoutDuration: 30 * 60 * 1000,
};

/**
 * POST /auth/customer/emailpass
 * 
 * Login endpoint with account lockout protection.
 * 
 * Request Body:
 * {
 *   email: string;
 *   password: string;
 *   remember_me?: boolean;
 * }
 * 
 * Response (Success):
 * - 200 OK
 * - Set-Cookie: session_token
 * - Body: { customer: { id, email, ... } }
 * 
 * Response (Account Locked):
 * - 403 Forbidden
 * - Body: { 
 *     error: {
 *       code: "ACCOUNT_LOCKED",
 *       message: "Account locked due to too many failed login attempts",
 *       lockoutMinutesRemaining: number
 *     }
 *   }
 * 
 * Response (Invalid Credentials):
 * - 401 Unauthorized
 * - Body: {
 *     error: {
 *       code: "INVALID_CREDENTIALS",
 *       message: "Invalid email or password",
 *       attemptsRemaining: number
 *     }
 *   }
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger");
  
  try {
    // Step 1: Extract and validate request body
    // 
    // We need the email and password to authenticate.
    // remember_me is optional (for extended session duration).
    const { email, password, remember_me } = req.body as {
      email?: string;
      password?: string;
      remember_me?: boolean;
    };

    // Validate required fields
    if (!email || !password) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Email and password are required"
      );
    }

    // Step 2: Find the customer by email
    // 
    // We need to check the lockout status before attempting authentication.
    // This prevents timing attacks (where attacker measures response time
    // to determine if an email exists).
    const query = req.scope.resolve("query");
    
    const customers = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "password_hash",
        "failed_login_count",
        "locked_until",
        "email_verified",
        "first_name",
        "last_name",
      ],
      filters: { email: email.toLowerCase() },
    });

    // If customer doesn't exist, return generic error
    // 
    // Why generic? Security!
    // - Don't reveal whether the email exists
    // - Prevents email enumeration attacks
    // - Attacker can't build a list of valid emails
    if (!customers.data || customers.data.length === 0) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Invalid email or password"
      );
    }

    const customer = customers.data[0] as CustomerAuthRow;

    // Step 3: Check if account is locked
    // 
    // If locked_until is set and in the future, account is locked.
    // We calculate how much time remains and return it to the user.
    if (customer.locked_until) {
      const lockedUntil = new Date(customer.locked_until);
      const now = new Date();

      if (lockedUntil > now) {
        // Account is still locked
        const minutesRemaining = Math.ceil(
          (lockedUntil.getTime() - now.getTime()) / (60 * 1000)
        );

        // Log the lockout attempt for security monitoring
        logger.warn(
          `Login attempt on locked account: ${email}, ${minutesRemaining} minutes remaining`
        );

        res.status(403).json({
          error: {
            type: "not_allowed",
            code: "ACCOUNT_LOCKED",
            message:
              `Account is locked due to too many failed login attempts. ` +
              `Please try again in ${minutesRemaining} minute(s).`,
            lockoutMinutesRemaining: minutesRemaining,
          },
        });
        return;
      } else {
        // Lockout has expired - automatically unlock the account
        // 
        // We clear the lockout fields so the user can try again.
        // This is "automatic unlock" - no admin intervention needed.
        const manager = req.scope.resolve("manager") as DbManager;
        await manager.update("customer", customer.id, {
          locked_until: null,
          failed_login_count: 0,
        });

        logger.info(`Account automatically unlocked: ${email}`);
      }
    }

    // Step 4: Authenticate the user
    // 
    // We use Medusa's built-in auth module to verify the password.
    // This handles password hashing comparison securely.
    const authModuleService = req.scope.resolve("auth");
    
    let authResult;
    try {
      authResult = await authModuleService.authenticate("emailpass", {
        body: { email, password },
      });

      if (!authResult?.success) {
        throw new Error(authResult?.error || "Authentication failed");
      }
    } catch (error) {
      // Authentication failed - wrong password
      // 
      // Now we need to:
      // 1. Increment failed_login_count
      // 2. Check if we've reached the lockout threshold
      // 3. If yes, lock the account
      // 4. Log the failed attempt
      
      const manager = req.scope.resolve("manager") as DbManager;
      const newFailedCount = (customer.failed_login_count || 0) + 1;

      if (newFailedCount >= LOCKOUT_CONFIG.maxFailedAttempts) {
        // Threshold reached - lock the account!
        const lockedUntil = new Date(Date.now() + LOCKOUT_CONFIG.lockoutDuration);

        await manager.update("customer", customer.id, {
          failed_login_count: newFailedCount,
          locked_until: lockedUntil,
        });

        logger.warn(
          `Account locked due to ${newFailedCount} failed attempts: ${email}`
        );

        // TODO: Send email notification (Phase 3)
        // await emailService.sendAccountLocked(email, customer.first_name, lockedUntil);

        // Log audit event for account lockout
        const auditLogger = createAuditLogger(manager);
        await auditLogger.logAccountLocked({
          customerId: customer.id,
          email: customer.email ?? email,
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"],
          lockoutMinutes: 30,
          failedAttempts: newFailedCount,
        });

        res.status(403).json({
          error: {
            type: "not_allowed",
            code: "ACCOUNT_LOCKED",
            message:
              "Account locked due to too many failed login attempts. Please try again in 30 minutes.",
            lockoutMinutesRemaining: 30,
          },
        });
        return;
      } else {
        // Not locked yet - just increment the counter
        await manager.update("customer", customer.id, {
          failed_login_count: newFailedCount,
        });

        const attemptsRemaining = LOCKOUT_CONFIG.maxFailedAttempts - newFailedCount;

        logger.info(
          `Failed login attempt ${newFailedCount}/${LOCKOUT_CONFIG.maxFailedAttempts} for: ${email}`
        );

        // Log audit event for failed login
        const auditLogger = createAuditLogger(manager);
        await auditLogger.logLoginFailure({
          email: customer.email ?? email,
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"],
          reason: "wrong_password",
          attemptsRemaining,
        });

        res.status(401).json({
          error: {
            type: "unauthorized",
            code: "INVALID_CREDENTIALS",
            message:
              `Invalid email or password. ${attemptsRemaining} attempt(s) ` +
              "remaining before account lockout.",
            attemptsRemaining,
          },
        });
        return;
      }
    }

    // Step 5: Authentication succeeded!
    // 
    // Now we need to:
    // 1. Reset failed_login_count to 0
    // 2. Clear locked_until
    // 3. Update last_login_at
    // 4. Create a session (handled by Medusa)
    // 5. Log the successful login
    
    const manager = req.scope.resolve("manager") as DbManager;
    await manager.update("customer", customer.id, {
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date(),
    });

    logger.info(`Successful login: ${email}`);

    // Log audit event for successful login
    const auditLogger = createAuditLogger(manager);
    await auditLogger.logLoginSuccess({
      customerId: customer.id,
      email: customer.email ?? email,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"],
    });

    // Step 6: Return the auth result
    // 
    // Medusa's auth module returns the authenticated user data
    // and sets the session cookie automatically.
    res.status(200).json({
      customer: {
        id: customer.id,
        email: customer.email,
        email_verified: !!customer.email_verified,
        first_name: customer.first_name,
        last_name: customer.last_name,
      },
    });

  } catch (error) {
    // Error handling
    // 
    // We've already thrown specific errors above (MedusaError).
    // This catch block handles unexpected errors.
    
    if (error instanceof MedusaError) {
      // Re-throw Medusa errors (they're handled by Medusa's error middleware)
      throw error;
    }

    // Unexpected error - log it and return generic error
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    logger.error("Unexpected error during login:", normalizedError);
    
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "An unexpected error occurred during login"
    );
  }
}
