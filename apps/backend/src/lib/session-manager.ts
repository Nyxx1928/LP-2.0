/**
 * Session Manager
 * 
 * This service manages authenticated user sessions using JWT tokens.
 * 
 * Key Concepts:
 * - JWT (JSON Web Token): A self-contained token that includes user data
 * - Stateless: The token itself contains all the info we need (no server-side storage required)
 * - But we ALSO store session metadata in the database for revocation capability
 * 
 * Why both JWT AND database storage?
 * - JWT: Fast validation (no database lookup needed for every request)
 * - Database: Allows us to revoke sessions (logout, security breach, etc.)
 * 
 * Session Lifecycle:
 * 1. Create: User logs in → Generate JWT → Store metadata in database
 * 2. Validate: User makes request → Verify JWT → Check if session still exists in database
 * 3. Extend: User is active → Update last_activity_at → Extend expiration (sliding window)
 * 4. Invalidate: User logs out → Delete from database (JWT becomes invalid)
 * 
 * Security Features:
 * - HTTP-only cookies (JavaScript can't access them - prevents XSS attacks)
 * - Secure flag (only sent over HTTPS)
 * - SameSite=Strict (prevents CSRF attacks)
 * - Token hashing in database (if database is compromised, tokens can't be used)
 * - Sliding expiration (session extends with activity, expires with inactivity)
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Device information extracted from User-Agent string
 * 
 * This helps users identify their sessions:
 * "Chrome on Windows" vs "Safari on iPhone"
 */
export interface DeviceInfo {
  browser?: string;
  os?: string;
  device?: string;
}

/**
 * Session configuration
 * 
 * These values control session behavior:
 * - jwtSecret: Secret key for signing JWTs (MUST be strong!)
 * - sessionTimeout: How long until inactive session expires (24 hours)
 * - rememberMeDuration: Extended duration for "Remember Me" (30 days)
 * - bcryptRounds: Cost factor for hashing tokens (10 is good balance)
 */
export interface SessionConfig {
  jwtSecret: string;
  sessionTimeout: number; // milliseconds
  rememberMeDuration: number; // milliseconds
  bcryptRounds: number;
}

/**
 * JWT payload structure
 * 
 * This is the data we encode inside the JWT token.
 * Keep it minimal - larger tokens = slower requests!
 */
export interface JWTPayload {
  customerId: string;
  email: string;
  sessionId: string;
  rememberMe: boolean;
  iat?: number; // Issued at (automatically added by jwt.sign)
  exp?: number; // Expiration (automatically added by jwt.sign)
}

/**
 * Session data structure
 * 
 * This represents a session record in the database.
 * It includes more info than the JWT (device, IP, activity tracking).
 */
export interface SessionData {
  id: string;
  customerId: string;
  email: string;
  tokenHash: string;
  rememberMe: boolean;
  deviceInfo?: DeviceInfo;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

/**
 * Database interface
 * 
 * This defines the methods we need from the database.
 * Using an interface makes the service testable (we can mock the database).
 */
export interface SessionDatabase {
  createSession(session: Omit<SessionData, 'createdAt' | 'lastActivityAt'>): Promise<SessionData>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionData | null>;
  findSessionById(id: string): Promise<SessionData | null>;
  updateLastActivity(id: string, expiresAt: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteAllSessionsExcept(customerId: string, exceptSessionId?: string): Promise<number>;
  listActiveSessions(customerId: string): Promise<SessionData[]>;
  deleteExpiredSessions(): Promise<number>;
}

/**
 * Default configuration
 * 
 * These values follow security best practices:
 * - 24 hours for normal sessions (balance between security and convenience)
 * - 30 days for "Remember Me" (user convenience)
 * - 10 bcrypt rounds (balance between security and performance)
 */
const DEFAULT_CONFIG: Omit<SessionConfig, 'jwtSecret'> = {
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  rememberMeDuration: 30 * 24 * 60 * 60 * 1000, // 30 days
  bcryptRounds: 10,
};

/**
 * SessionManager class
 * 
 * Why a class?
 * - Encapsulation: Bundle related functionality
 * - Dependency Injection: Pass in database and config
 * - Testability: Easy to mock dependencies
 * - State Management: Store configuration
 */
export class SessionManager {
  private config: SessionConfig;
  private db: SessionDatabase;

  /**
   * Constructor
   * 
   * @param db - Database interface for session storage
   * @param jwtSecret - Secret key for signing JWTs (MUST be at least 32 characters!)
   * @param config - Optional custom configuration
   */
  constructor(
    db: SessionDatabase,
    jwtSecret: string,
    config: Partial<Omit<SessionConfig, 'jwtSecret'>> = {}
  ) {
    // Validate JWT secret strength
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        'JWT secret must be at least 32 characters long for security. ' +
        'Set JWT_SECRET environment variable with a strong random string.'
      );
    }

    this.db = db;
    this.config = {
      jwtSecret,
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Create a new session
   * 
   * This is called when a user logs in successfully.
   * 
   * Flow:
   * 1. Generate a unique session ID
   * 2. Create JWT token with user data
   * 3. Hash the JWT token
   * 4. Store session metadata in database (using sessionId as the database ID)
   * 5. Return the raw JWT token (to be set in cookie)
   * 
   * Why hash the token in the database?
   * - If the database is compromised, attackers can't use the tokens
   * - They'd need to crack the bcrypt hash (very difficult)
   * 
   * @param customerId - The customer's ID
   * @param email - The customer's email
   * @param rememberMe - Whether to use extended duration
   * @param deviceInfo - Optional device information
   * @param ipAddress - Optional IP address
   * @param userAgent - Optional user agent string
   * @returns The raw JWT token (to be set in HTTP-only cookie)
   */
  async createSession(
    customerId: string,
    email: string,
    rememberMe: boolean = false,
    deviceInfo?: DeviceInfo,
    ipAddress?: string,
    userAgent?: string
  ): Promise<string> {
    // Generate a unique session ID
    // Why crypto.randomBytes? It's cryptographically secure (unpredictable)
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Calculate expiration time based on "Remember Me" setting
    const duration = rememberMe
      ? this.config.rememberMeDuration
      : this.config.sessionTimeout;
    const expiresAt = new Date(Date.now() + duration);

    // Create JWT payload
    const payload: JWTPayload = {
      customerId,
      email,
      sessionId,
      rememberMe,
    };

    // Sign the JWT token
    // This creates a token that:
    // 1. Contains the payload data
    // 2. Is signed with our secret (can't be tampered with)
    // 3. Has an expiration time
    const token = jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: Math.floor(duration / 1000), // Convert ms to seconds
    });

    // Hash the token for database storage
    // Why hash? Security in depth - even if database is compromised, tokens are safe
    const tokenHash = await bcrypt.hash(token, this.config.bcryptRounds);

    // Store session metadata in database
    // Important: We need to pass the sessionId as 'id' so the database uses it
    await this.db.createSession({
      id: sessionId, // Use the sessionId from JWT as the database ID
      customerId,
      email,
      tokenHash,
      rememberMe,
      deviceInfo,
      ipAddress,
      userAgent,
      expiresAt,
    });

    // Return the raw token (this is what gets set in the cookie)
    return token;
  }

  /**
   * Validate a session token
   * 
   * This is called on every authenticated request to verify the user's session.
   * 
   * Flow:
   * 1. Verify JWT signature and expiration
   * 2. Extract session ID from JWT
   * 3. Look up session in database
   * 4. Check if session has expired
   * 5. Verify token hash matches
   * 
   * Why check both JWT AND database?
   * - JWT: Fast validation (signature, expiration)
   * - Database: Allows revocation (logout, security breach)
   * 
   * @param token - The JWT token from the cookie
   * @returns Session data if valid, null if invalid
   */
  async validateSession(token: string): Promise<SessionData | null> {
    try {
      // Step 1: Verify JWT signature and expiration
      // This throws an error if:
      // - Token is malformed
      // - Signature doesn't match (token was tampered with)
      // - Token has expired
      const decoded = jwt.verify(token, this.config.jwtSecret) as JWTPayload;

      // Step 2: Look up session in database by ID
      const session = await this.db.findSessionById(decoded.sessionId);

      // Session doesn't exist (was deleted/revoked)
      if (!session) {
        return null;
      }

      // Step 3: Check if session has expired
      // Why check again? Database expiration might be different from JWT expiration
      // (e.g., if we extended the session)
      if (session.expiresAt < new Date()) {
        // Clean up expired session
        await this.db.deleteSession(session.id);
        return null;
      }

      // Step 4: Verify token hash matches
      // This is an extra security check - ensures the token in the cookie
      // matches the one we stored when the session was created
      const isValid = await bcrypt.compare(token, session.tokenHash);
      if (!isValid) {
        return null;
      }

      // All checks passed - session is valid!
      return session;
    } catch (error) {
      // JWT verification failed (invalid signature, expired, malformed)
      // This is expected for invalid tokens - not an error to log
      return null;
    }
  }

  /**
   * Extend a session (sliding expiration)
   * 
   * This is called when a user makes a request with a valid session.
   * It extends the session expiration, so active users don't get logged out.
   * 
   * This is called "sliding window" expiration:
   * - If you're active, your session keeps extending
   * - If you're inactive for 24 hours, your session expires
   * 
   * Flow:
   * 1. Calculate new expiration time (now + session timeout)
   * 2. Update last_activity_at and expires_at in database
   * 
   * @param sessionId - The session ID to extend
   */
  async extendSession(sessionId: string): Promise<void> {
    // Look up the session to get its rememberMe setting
    const session = await this.db.findSessionById(sessionId);
    
    if (!session) {
      return; // Session doesn't exist, nothing to extend
    }

    // Calculate new expiration time based on rememberMe setting
    const duration = session.rememberMe
      ? this.config.rememberMeDuration
      : this.config.sessionTimeout;
    const newExpiresAt = new Date(Date.now() + duration);

    // Update last activity and expiration in database
    await this.db.updateLastActivity(sessionId, newExpiresAt);
  }

  /**
   * Invalidate a single session (logout)
   * 
   * This is called when a user logs out or when we need to revoke a session.
   * 
   * Flow:
   * 1. Delete session from database
   * 2. JWT becomes invalid (database lookup fails)
   * 
   * Note: The JWT itself doesn't change, but it becomes useless because
   * the database record is gone.
   * 
   * @param sessionId - The session ID to invalidate
   */
  async invalidateSession(sessionId: string): Promise<void> {
    await this.db.deleteSession(sessionId);
  }

  /**
   * Invalidate all sessions for a customer (except optionally one)
   * 
   * This is called when:
   * - User changes password (logout from all devices except current)
   * - User clicks "Logout from all devices"
   * - Security breach detected
   * 
   * Flow:
   * 1. Delete all sessions for customer from database
   * 2. Optionally keep one session (the current one)
   * 
   * @param customerId - The customer ID
   * @param exceptSessionId - Optional session ID to keep (usually current session)
   * @returns Number of sessions invalidated
   */
  async invalidateAllSessions(
    customerId: string,
    exceptSessionId?: string
  ): Promise<number> {
    return this.db.deleteAllSessionsExcept(customerId, exceptSessionId);
  }

  /**
   * List all active sessions for a customer
   * 
   * This is used for the "Active Sessions" page where users can see:
   * - Where they're logged in (device, location)
   * - When they last used each session
   * - Option to revoke individual sessions
   * 
   * @param customerId - The customer ID
   * @returns Array of active sessions
   */
  async listActiveSessions(customerId: string): Promise<SessionData[]> {
    return this.db.listActiveSessions(customerId);
  }

  /**
   * Clean up expired sessions
   * 
   * This should be run periodically (e.g., daily cron job) to:
   * - Free up database space
   * - Maintain performance
   * - Comply with data retention policies
   * 
   * @returns Number of sessions deleted
   */
  async cleanupExpiredSessions(): Promise<number> {
    return this.db.deleteExpiredSessions();
  }

  /**
   * Extract session ID from a JWT token without full validation
   * 
   * This is useful when you need the session ID but don't want to
   * do a full validation (e.g., for logging, metrics).
   * 
   * Warning: This does NOT validate the token! Only use for non-security purposes.
   * 
   * @param token - The JWT token
   * @returns Session ID if token is decodable, null otherwise
   */
  extractSessionId(token: string): string | null {
    try {
      // Decode without verification (just parse the payload)
      const decoded = jwt.decode(token) as JWTPayload | null;
      return decoded?.sessionId || null;
    } catch {
      return null;
    }
  }
}
