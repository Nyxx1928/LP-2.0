/**
 * Token Service
 * 
 * This service manages temporary authentication tokens for:
 * - Password reset flows
 * - Email verification flows
 * 
 * Token Lifecycle:
 * 1. Generate: Create a random token and store its hash in the database
 * 2. Send: Email the token to the user (handled by EmailService)
 * 3. Validate: Check if token exists, hasn't expired, and hasn't been used
 * 4. Consume: Mark token as used after successful action
 * 5. Cleanup: Periodically delete expired tokens
 * 
 * Security Features:
 * - Cryptographically secure random generation (crypto.randomBytes)
 * - Hashed storage (bcrypt) - never store raw tokens
 * - Time-limited expiration
 * - Single-use enforcement
 * - Rate limiting (handled by caller)
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Token types
 * 
 * We use a union type to ensure type safety - only these two values are allowed.
 * This prevents typos like 'password_reste' or 'email_verify'.
 */
export type TokenType = 'password_reset' | 'email_verification';

/**
 * Token configuration
 * 
 * Different token types have different expiration times:
 * - Password reset: 1 hour (short for security)
 * - Email verification: 24 hours (longer for convenience)
 */
export interface TokenConfig {
  passwordResetExpiration: number; // milliseconds
  emailVerificationExpiration: number; // milliseconds
  tokenLength: number; // bytes (32 bytes = 256 bits)
  bcryptRounds: number; // hashing cost factor
}

/**
 * Token data structure
 * 
 * This represents a token record in the database.
 */
export interface Token {
  id: string;
  type: TokenType;
  customerId: string | null;
  email: string;
  tokenHash: string;
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Database interface
 * 
 * This defines the methods we need from the database.
 * Using an interface makes the service testable (we can mock the database).
 */
export interface TokenDatabase {
  createToken(token: Omit<Token, 'id' | 'createdAt'>): Promise<Token>;
  findTokenByHash(tokenHash: string): Promise<Token | null>;
  markTokenAsUsed(id: string): Promise<void>;
  deleteExpiredTokens(): Promise<number>;
  countRecentTokens(email: string, type: TokenType, since: Date): Promise<number>;
}

/**
 * Default configuration
 * 
 * These values follow security best practices:
 * - 1 hour for password reset (OWASP recommendation)
 * - 24 hours for email verification (user convenience)
 * - 32 bytes = 256 bits of entropy (very secure)
 * - 10 bcrypt rounds (balance between security and performance)
 */
const DEFAULT_CONFIG: TokenConfig = {
  passwordResetExpiration: 60 * 60 * 1000, // 1 hour
  emailVerificationExpiration: 24 * 60 * 60 * 1000, // 24 hours
  tokenLength: 32, // 32 bytes = 256 bits
  bcryptRounds: 10,
};

/**
 * TokenService class
 * 
 * Why a class?
 * - Encapsulation: Bundle related functionality
 * - Dependency Injection: Pass in database and config
 * - Testability: Easy to mock dependencies
 * - State Management: Store configuration
 */
export class TokenService {
  private config: TokenConfig;
  private db: TokenDatabase;

  /**
   * Constructor
   * 
   * @param db - Database interface for token storage
   * @param config - Optional custom configuration
   */
  constructor(db: TokenDatabase, config: Partial<TokenConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a password reset token
   * 
   * Flow:
   * 1. Generate random token
   * 2. Hash the token
   * 3. Store hash in database with 1-hour expiration
   * 4. Return raw token (to be sent via email)
   * 
   * @param email - Email address to send reset link to
   * @param customerId - Optional customer ID (null if email doesn't exist)
   * @returns Raw token string (to be sent in email)
   */
  async generatePasswordResetToken(
    email: string,
    customerId: string | null = null
  ): Promise<string> {
    return this.generateToken(email, 'password_reset', customerId);
  }

  /**
   * Generate an email verification token
   * 
   * Flow:
   * 1. Generate random token
   * 2. Hash the token
   * 3. Store hash in database with 24-hour expiration
   * 4. Return raw token (to be sent via email)
   * 
   * @param email - Email address to verify
   * @param customerId - Customer ID
   * @returns Raw token string (to be sent in email)
   */
  async generateEmailVerificationToken(
    email: string,
    customerId: string
  ): Promise<string> {
    return this.generateToken(email, 'email_verification', customerId);
  }

  /**
   * Generate a token (internal method)
   * 
   * This is the core token generation logic used by both public methods.
   * 
   * Why use crypto.randomBytes instead of Math.random?
   * - Math.random() is NOT cryptographically secure
   * - It's predictable and can be guessed
   * - crypto.randomBytes() uses the OS's secure random number generator
   * 
   * @param email - Email address
   * @param type - Token type
   * @param customerId - Optional customer ID
   * @returns Raw token string
   */
  private async generateToken(
    email: string,
    type: TokenType,
    customerId: string | null
  ): Promise<string> {
    // Generate cryptographically secure random bytes
    const tokenBytes = crypto.randomBytes(this.config.tokenLength);
    
    // Convert to URL-safe base64 string
    // Why base64url? It's safe to use in URLs (no +, /, = characters)
    const rawToken = tokenBytes.toString('base64url');

    // Hash the token before storing
    // Why hash? If database is compromised, attacker can't use tokens
    const tokenHash = await bcrypt.hash(rawToken, this.config.bcryptRounds);

    // Calculate expiration time
    const expiresAt = new Date(
      Date.now() +
        (type === 'password_reset'
          ? this.config.passwordResetExpiration
          : this.config.emailVerificationExpiration)
    );

    // Store token in database
    await this.db.createToken({
      type,
      customerId,
      email,
      tokenHash,
      used: false,
      expiresAt,
    });

    // Return raw token (this is what gets sent in the email)
    return rawToken;
  }

  /**
   * Validate a password reset token
   * 
   * Checks:
   * 1. Token exists in database
   * 2. Token hasn't expired
   * 3. Token hasn't been used
   * 4. Token hash matches
   * 
   * @param rawToken - The token from the email link
   * @returns Token data if valid, null if invalid
   */
  async validatePasswordResetToken(rawToken: string): Promise<Token | null> {
    return this.validateToken(rawToken, 'password_reset');
  }

  /**
   * Validate an email verification token
   * 
   * Same checks as password reset, but for email verification type.
   * 
   * @param rawToken - The token from the email link
   * @returns Token data if valid, null if invalid
   */
  async validateEmailVerificationToken(rawToken: string): Promise<Token | null> {
    return this.validateToken(rawToken, 'email_verification');
  }

  /**
   * Validate a token (internal method)
   * 
   * This implements the core validation logic.
   * 
   * Why use bcrypt.compare instead of === ?
   * - We stored a hash, not the raw token
   * - bcrypt.compare() safely compares raw token with hash
   * - It's also constant-time (prevents timing attacks)
   * 
   * @param rawToken - The raw token to validate
   * @param expectedType - Expected token type
   * @returns Token data if valid, null if invalid
   */
  private async validateToken(
    rawToken: string,
    expectedType: TokenType
  ): Promise<Token | null> {
    // Hash the raw token to search for it
    // Note: We can't search by raw token since we only store hashes
    // So we need to fetch all tokens and compare hashes (inefficient but secure)
    // In production, you might use a different approach (e.g., store token ID in URL)
    
    // For now, we'll use a simpler approach: hash the token and search
    // This is a simplified implementation - in production, you'd optimize this
    const tokenHash = await this.hashToken(rawToken);
    
    const token = await this.db.findTokenByHash(tokenHash);

    // Token doesn't exist
    if (!token) {
      return null;
    }

    // Wrong token type
    if (token.type !== expectedType) {
      return null;
    }

    // Token has expired
    if (token.expiresAt < new Date()) {
      return null;
    }

    // Token has already been used
    if (token.used) {
      return null;
    }

    // Verify token hash matches (constant-time comparison)
    const isValid = await bcrypt.compare(rawToken, token.tokenHash);
    if (!isValid) {
      return null;
    }

    return token;
  }

  /**
   * Consume a token (mark as used)
   * 
   * After successfully using a token (resetting password, verifying email),
   * mark it as used so it can't be reused.
   * 
   * Why mark as used instead of deleting?
   * - Audit trail: We can see when tokens were used
   * - Security: Detect if someone tries to reuse a token
   * 
   * @param tokenId - The token ID to mark as used
   */
  async consumeToken(tokenId: string): Promise<void> {
    await this.db.markTokenAsUsed(tokenId);
  }

  /**
   * Check rate limit for token generation
   * 
   * Prevents abuse by limiting how many tokens can be generated
   * for an email address in a time window.
   * 
   * Recommended limits:
   * - Password reset: 3 per hour
   * - Email verification: 3 per hour
   * 
   * @param email - Email address
   * @param type - Token type
   * @param maxTokens - Maximum tokens allowed
   * @param windowMs - Time window in milliseconds
   * @returns true if rate limit exceeded
   */
  async isRateLimitExceeded(
    email: string,
    type: TokenType,
    maxTokens: number = 3,
    windowMs: number = 60 * 60 * 1000 // 1 hour
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const count = await this.db.countRecentTokens(email, type, since);
    return count >= maxTokens;
  }

  /**
   * Clean up expired tokens
   * 
   * This should be run periodically (e.g., daily cron job) to:
   * - Free up database space
   * - Maintain performance
   * - Comply with data retention policies
   * 
   * @returns Number of tokens deleted
   */
  async cleanupExpiredTokens(): Promise<number> {
    return this.db.deleteExpiredTokens();
  }

  /**
   * Hash a token for storage/lookup
   * 
   * Helper method to hash tokens consistently.
   * 
   * @param rawToken - Raw token string
   * @returns Hashed token
   */
  private async hashToken(rawToken: string): Promise<string> {
    return bcrypt.hash(rawToken, this.config.bcryptRounds);
  }
}
