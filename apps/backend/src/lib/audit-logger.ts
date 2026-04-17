/**
 * Audit Logger Service
 * 
 * This service provides a centralized way to log authentication and security events.
 * 
 * === WHAT IS AUDIT LOGGING? ===
 * 
 * Audit logging is the practice of recording security-relevant events in a system.
 * Think of it as a detailed diary that tracks:
 * - Who did something (customer ID, email)
 * - What they did (login, logout, password change)
 * - When they did it (timestamp)
 * - Where they did it from (IP address, user agent)
 * 
 * === WHY IS IT IMPORTANT? ===
 * 
 * 1. Security Monitoring
 *    - Detect brute force attacks (many failed logins)
 *    - Identify compromised accounts (login from unusual location)
 *    - Track suspicious patterns
 * 
 * 2. Compliance
 *    - GDPR: Must track access to personal data
 *    - HIPAA: Must log all access to health records
 *    - SOC 2: Must maintain audit trails
 *    - PCI DSS: Must log all authentication attempts
 * 
 * 3. Debugging and Support
 *    - "Why was my account locked?" → Check audit log
 *    - "I didn't receive the password reset email" → Check if request was made
 *    - "Someone logged into my account" → Check login history
 * 
 * 4. Forensics
 *    - After a security incident, audit logs help investigate:
 *      - When did the breach occur?
 *      - What accounts were affected?
 *      - What actions did the attacker take?
 * 
 * === WHAT DO WE LOG? ===
 * 
 * For each event, we record:
 * - Event Type: What happened (login_success, password_reset_request, etc.)
 * - Customer ID: Who did it (if authenticated)
 * - Email: Email address involved
 * - IP Address: Where the request came from
 * - User Agent: What browser/device was used
 * - Metadata: Additional context (e.g., reason for failure)
 * - Timestamp: When it happened (automatic)
 * 
 * === DESIGN DECISIONS ===
 * 
 * 1. Centralized Service
 *    - All logging goes through this service
 *    - Consistent format across the application
 *    - Easy to change logging behavior (e.g., add encryption)
 * 
 * 2. Structured Data
 *    - Store as structured data (not plain text)
 *    - Easy to query and analyze
 *    - Can filter by event type, customer, date range, etc.
 * 
 * 3. Async/Non-Blocking
 *    - Logging shouldn't slow down requests
 *    - Fire-and-forget pattern
 *    - If logging fails, don't fail the request
 * 
 * 4. Immutable
 *    - Audit logs should never be modified or deleted
 *    - Only INSERT operations, no UPDATE or DELETE
 *    - Tamper-proof audit trail
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This service satisfies:
 * - Requirement 14.1: Log successful logins
 * - Requirement 14.2: Log failed logins
 * - Requirement 14.3: Log logouts
 * - Requirement 14.4: Log password changes
 * - Requirement 14.5: Log password reset requests
 * - Requirement 14.6: Log account lockouts
 * - Requirement 14.7: Store logs in structured format
 */

/**
 * Event Types
 * 
 * These are all the types of events we can log.
 * Each event type represents a specific action in the authentication system.
 * 
 * Why use a type instead of plain strings?
 * - Type safety: TypeScript will catch typos at compile time
 * - Autocomplete: IDE will suggest valid event types
 * - Documentation: Easy to see all possible events
 */
export type AuditEventType =
  | "login_success"           // User successfully logged in
  | "login_failure"           // Login attempt failed (wrong password)
  | "logout"                  // User logged out
  | "password_change"         // User changed their password
  | "password_reset_request"  // User requested password reset email
  | "password_reset_complete" // User completed password reset
  | "email_verification"      // User verified their email
  | "account_locked"          // Account was locked due to failed attempts
  | "account_unlocked";       // Account was unlocked (manual or automatic)

/**
 * Audit Event Data
 * 
 * This interface defines the structure of an audit event.
 * 
 * Fields Explained:
 * - eventType: What happened (from AuditEventType)
 * - customerId: Who did it (optional - might not be authenticated)
 * - email: Email address involved (optional - might not be known)
 * - ipAddress: Where the request came from
 * - userAgent: What browser/device was used (optional)
 * - metadata: Additional context (optional, flexible JSON object)
 * 
 * Why some fields are optional?
 * - customerId: Not available for failed logins (user not authenticated)
 * - email: Not available for some events (e.g., logout might not include it)
 * - userAgent: Might not be present in all requests
 * - metadata: Not all events need extra context
 */
export interface AuditEventData {
  eventType: AuditEventType;
  customerId?: string;
  email?: string;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

/**
 * Audit Event (with ID and timestamp)
 * 
 * This is the complete audit event as stored in the database.
 * It includes the ID and timestamp that are added automatically.
 */
export interface AuditEvent extends AuditEventData {
  id: string;
  createdAt: Date;
}

/**
 * Database Interface
 * 
 * This interface defines how the AuditLogger interacts with the database.
 * 
 * Why use an interface?
 * - Dependency Injection: We can pass different database implementations
 * - Testing: Easy to create mock databases for tests
 * - Flexibility: Can switch database systems without changing AuditLogger
 * 
 * This is the "Dependency Inversion Principle" from SOLID:
 * - High-level module (AuditLogger) doesn't depend on low-level module (database)
 * - Both depend on abstraction (this interface)
 */
export interface AuditDatabase {
  /**
   * Create an audit event in the database
   * 
   * @param event - The audit event data to store
   * @returns The created event with ID and timestamp
   */
  createAuditEvent(event: AuditEventData): Promise<AuditEvent>;
}

/**
 * Audit Logger Service
 * 
 * This is the main service class that provides audit logging functionality.
 * 
 * Usage Example:
 * ```typescript
 * const auditLogger = new AuditLogger(database);
 * 
 * await auditLogger.logLoginSuccess({
 *   customerId: "cust_123",
 *   email: "user@example.com",
 *   ipAddress: "192.168.1.1",
 *   userAgent: "Mozilla/5.0...",
 * });
 * ```
 * 
 * Design Pattern: Facade
 * - Provides a simple interface to complex audit logging logic
 * - Hides database details from callers
 * - Makes it easy to add features (e.g., encryption, filtering)
 */
export class AuditLogger {
  /**
   * Constructor
   * 
   * @param db - Database implementation for storing audit events
   * 
   * Why pass database as parameter?
   * - Dependency Injection: Caller controls what database to use
   * - Testing: Can pass mock database in tests
   * - Flexibility: Can use different databases in different environments
   */
  constructor(private db: AuditDatabase) {}

  /**
   * Log a successful login
   * 
   * Called when a user successfully authenticates.
   * 
   * @param data - Login event data (customerId, email, IP, user agent)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logLoginSuccess({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   * });
   * ```
   */
  async logLoginSuccess(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      eventType: "login_success",
      ...data,
    });
  }

  /**
   * Log a failed login attempt
   * 
   * Called when authentication fails (wrong password, account locked, etc.)
   * 
   * @param data - Login failure data (email, IP, user agent, reason)
   * 
   * Why include reason in metadata?
   * - Helps distinguish between different failure types
   * - Useful for security monitoring (e.g., many "wrong_password" vs "account_locked")
   * 
   * Example:
   * ```typescript
   * await auditLogger.logLoginFailure({
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   *   reason: "wrong_password",
   *   attemptsRemaining: 3,
   * });
   * ```
   */
  async logLoginFailure(data: {
    email: string;
    ipAddress: string;
    userAgent?: string;
    reason?: string;
    attemptsRemaining?: number;
  }): Promise<void> {
    await this.log({
      eventType: "login_failure",
      email: data.email,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      metadata: {
        reason: data.reason,
        attemptsRemaining: data.attemptsRemaining,
      },
    });
  }

  /**
   * Log a logout
   * 
   * Called when a user explicitly logs out.
   * 
   * @param data - Logout event data (customerId, IP, user agent)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logLogout({
   *   customerId: "cust_123",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   * });
   * ```
   */
  async logLogout(data: {
    customerId: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      eventType: "logout",
      ...data,
    });
  }

  /**
   * Log a password change
   * 
   * Called when a user changes their password (not password reset).
   * 
   * @param data - Password change event data (customerId, email, IP, user agent)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logPasswordChange({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   * });
   * ```
   */
  async logPasswordChange(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      eventType: "password_change",
      ...data,
    });
  }

  /**
   * Log a password reset request
   * 
   * Called when a user requests a password reset email.
   * 
   * @param data - Password reset request data (email, IP, user agent, success)
   * 
   * Why include success in metadata?
   * - Tracks whether email exists (for internal monitoring)
   * - Helps detect email enumeration attempts
   * - Note: We don't reveal this to the user (security)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logPasswordResetRequest({
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   *   success: true, // Email exists and token was generated
   * });
   * ```
   */
  async logPasswordResetRequest(data: {
    email: string;
    ipAddress: string;
    userAgent?: string;
    success: boolean;
  }): Promise<void> {
    await this.log({
      eventType: "password_reset_request",
      email: data.email,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      metadata: {
        success: data.success,
      },
    });
  }

  /**
   * Log a completed password reset
   * 
   * Called when a user successfully resets their password using a token.
   * 
   * @param data - Password reset completion data (customerId, email, IP, user agent)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logPasswordResetComplete({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   * });
   * ```
   */
  async logPasswordResetComplete(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      eventType: "password_reset_complete",
      ...data,
    });
  }

  /**
   * Log an email verification
   * 
   * Called when a user verifies their email address.
   * 
   * @param data - Email verification data (customerId, email, IP, user agent)
   * 
   * Example:
   * ```typescript
   * await auditLogger.logEmailVerification({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   * });
   * ```
   */
  async logEmailVerification(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      eventType: "email_verification",
      ...data,
    });
  }

  /**
   * Log an account lockout
   * 
   * Called when an account is locked due to too many failed login attempts.
   * 
   * @param data - Account lockout data (customerId, email, IP, user agent, lockout duration)
   * 
   * Why include lockoutMinutes in metadata?
   * - Helps track lockout policy effectiveness
   * - Useful for security monitoring
   * - Can analyze if lockout duration is appropriate
   * 
   * Example:
   * ```typescript
   * await auditLogger.logAccountLocked({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   userAgent: req.headers["user-agent"],
   *   lockoutMinutes: 30,
   *   failedAttempts: 5,
   * });
   * ```
   */
  async logAccountLocked(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    userAgent?: string;
    lockoutMinutes: number;
    failedAttempts: number;
  }): Promise<void> {
    await this.log({
      eventType: "account_locked",
      customerId: data.customerId,
      email: data.email,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      metadata: {
        lockoutMinutes: data.lockoutMinutes,
        failedAttempts: data.failedAttempts,
      },
    });
  }

  /**
   * Log an account unlock
   * 
   * Called when an account is unlocked (automatically or manually).
   * 
   * @param data - Account unlock data (customerId, email, unlock method)
   * 
   * Why include unlockMethod in metadata?
   * - Distinguish between automatic (timeout) and manual (admin) unlocks
   * - Helps track if users are frequently getting locked out
   * 
   * Example:
   * ```typescript
   * await auditLogger.logAccountUnlocked({
   *   customerId: "cust_123",
   *   email: "user@example.com",
   *   ipAddress: req.ip,
   *   unlockMethod: "automatic", // or "manual"
   * });
   * ```
   */
  async logAccountUnlocked(data: {
    customerId: string;
    email: string;
    ipAddress: string;
    unlockMethod: "automatic" | "manual";
  }): Promise<void> {
    await this.log({
      eventType: "account_unlocked",
      customerId: data.customerId,
      email: data.email,
      ipAddress: data.ipAddress,
      metadata: {
        unlockMethod: data.unlockMethod,
      },
    });
  }

  /**
   * Generic log method
   * 
   * This is the core logging method that all other methods use.
   * It handles the actual database insertion.
   * 
   * @param event - The audit event data to log
   * 
   * Why make this private?
   * - Forces callers to use specific methods (logLoginSuccess, etc.)
   * - Ensures consistent event structure
   * - Makes it easier to add validation or transformation
   * 
   * Error Handling:
   * - We catch and log errors but don't throw them
   * - Logging failures shouldn't break the application
   * - Fire-and-forget pattern for better performance
   */
  private async log(event: AuditEventData): Promise<void> {
    try {
      await this.db.createAuditEvent(event);
    } catch (error) {
      // Log the error but don't throw it
      // Audit logging failures shouldn't break the application
      console.error("Failed to create audit event:", error);
      
      // In production, you might want to:
      // - Send to error tracking service (Sentry, Rollbar)
      // - Write to a fallback log file
      // - Queue for retry
    }
  }
}

/**
 * Helper function to create AuditLogger with Medusa database
 * 
 * This function creates an AuditLogger instance configured for Medusa.
 * It adapts Medusa's database interface to work with AuditLogger.
 * 
 * @param manager - Medusa's entity manager
 * @returns Configured AuditLogger instance
 * 
 * Usage in Medusa endpoints:
 * ```typescript
 * const manager = req.scope.resolve("manager");
 * const auditLogger = createAuditLogger(manager);
 * 
 * await auditLogger.logLoginSuccess({
 *   customerId: customer.id,
 *   email: customer.email,
 *   ipAddress: req.ip,
 *   userAgent: req.headers["user-agent"],
 * });
 * ```
 * 
 * Why a helper function?
 * - Simplifies usage in endpoints
 * - Encapsulates Medusa-specific logic
 * - Makes it easy to change implementation later
 */
export function createAuditLogger(manager: any): AuditLogger {
  // Create database adapter for Medusa
  const db: AuditDatabase = {
    async createAuditEvent(event: AuditEventData): Promise<AuditEvent> {
      // Generate unique ID
      // Format: audit_{timestamp}_{random}
      // Example: audit_1704067200000_abc123
      const id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create timestamp
      const createdAt = new Date();
      
      // Insert into database
      await manager.create("audit_event", {
        id,
        event_type: event.eventType,
        customer_id: event.customerId || null,
        email: event.email || null,
        ip_address: event.ipAddress,
        user_agent: event.userAgent || null,
        metadata: event.metadata || null,
        created_at: createdAt,
      });
      
      // Return the complete event
      return {
        id,
        ...event,
        createdAt,
      };
    },
  };
  
  return new AuditLogger(db);
}
