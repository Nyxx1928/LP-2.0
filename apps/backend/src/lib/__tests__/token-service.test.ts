/**
 * Token Service Tests
 * 
 * These tests verify that our token service correctly:
 * - Generates secure random tokens
 * - Stores hashed tokens (never raw)
 * - Validates tokens correctly
 * - Enforces expiration
 * - Enforces single-use
 * - Handles rate limiting
 */

import { TokenService, Token, TokenDatabase, TokenType } from '../token-service';
import bcrypt from 'bcrypt';

/**
 * Mock Database Implementation
 * 
 * This is an in-memory database for testing.
 * It implements the TokenDatabase interface without needing a real database.
 * 
 * Why mock the database?
 * - Tests run faster (no database I/O)
 * - Tests are isolated (no shared state between tests)
 * - Tests are deterministic (no database connection issues)
 */
class MockTokenDatabase implements TokenDatabase {
  private tokens: Map<string, Token> = new Map();
  private idCounter = 1;

  async createToken(data: Omit<Token, 'id' | 'createdAt'>): Promise<Token> {
    const token: Token = {
      ...data,
      id: `token_${this.idCounter++}`,
      createdAt: new Date(),
    };
    this.tokens.set(token.id, token);
    return token;
  }

  async findTokenByHash(tokenHash: string): Promise<Token | null> {
    // In a real database, we'd search by hash
    // For testing, we iterate through all tokens
    for (const token of this.tokens.values()) {
      // Use bcrypt.compare for secure comparison
      const matches = await bcrypt.compare(tokenHash, token.tokenHash);
      if (matches) {
        return token;
      }
    }
    return null;
  }

  async markTokenAsUsed(id: string): Promise<void> {
    const token = this.tokens.get(id);
    if (token) {
      token.used = true;
    }
  }

  async deleteExpiredTokens(): Promise<number> {
    const now = new Date();
    let deleted = 0;
    
    for (const [id, token] of this.tokens.entries()) {
      if (token.expiresAt < now) {
        this.tokens.delete(id);
        deleted++;
      }
    }
    
    return deleted;
  }

  async countRecentTokens(
    email: string,
    type: TokenType,
    since: Date
  ): Promise<number> {
    let count = 0;
    
    for (const token of this.tokens.values()) {
      if (
        token.email === email &&
        token.type === type &&
        token.createdAt >= since
      ) {
        count++;
      }
    }
    
    return count;
  }

  // Helper method for tests
  clear(): void {
    this.tokens.clear();
    this.idCounter = 1;
  }
}

describe('TokenService', () => {
  let service: TokenService;
  let db: MockTokenDatabase;

  beforeEach(() => {
    db = new MockTokenDatabase();
    service = new TokenService(db);
  });

  afterEach(() => {
    db.clear();
  });

  describe('Token Generation', () => {
    it('should generate a password reset token', async () => {
      const email = 'user@example.com';
      const token = await service.generatePasswordResetToken(email);

      // Token should be a non-empty string
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate an email verification token', async () => {
      const email = 'user@example.com';
      const customerId = 'customer_123';
      const token = await service.generateEmailVerificationToken(email, customerId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate unique tokens', async () => {
      const email = 'user@example.com';
      
      // Generate multiple tokens
      const token1 = await service.generatePasswordResetToken(email);
      const token2 = await service.generatePasswordResetToken(email);
      const token3 = await service.generatePasswordResetToken(email);

      // All tokens should be different
      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    it('should generate URL-safe tokens', async () => {
      const email = 'user@example.com';
      const token = await service.generatePasswordResetToken(email);

      // Token should only contain URL-safe characters
      // base64url uses: A-Z, a-z, 0-9, -, _
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should store hashed tokens, not raw tokens', async () => {
      const email = 'user@example.com';
      const rawToken = await service.generatePasswordResetToken(email);

      // Get the stored token from database
      const storedTokens = Array.from((db as any).tokens.values());
      expect(storedTokens).toHaveLength(1);

      const storedToken = storedTokens[0];
      
      // Stored token hash should NOT equal raw token
      expect(storedToken.tokenHash).not.toBe(rawToken);
      
      // But bcrypt.compare should verify they match
      const matches = await bcrypt.compare(rawToken, storedToken.tokenHash);
      expect(matches).toBe(true);
    });
  });

  describe('Token Validation', () => {
    it('should validate a valid password reset token', async () => {
      const email = 'user@example.com';
      const rawToken = await service.generatePasswordResetToken(email);

      const validatedToken = await service.validatePasswordResetToken(rawToken);

      expect(validatedToken).not.toBeNull();
      expect(validatedToken?.email).toBe(email);
      expect(validatedToken?.type).toBe('password_reset');
      expect(validatedToken?.used).toBe(false);
    });

    it('should validate a valid email verification token', async () => {
      const email = 'user@example.com';
      const customerId = 'customer_123';
      const rawToken = await service.generateEmailVerificationToken(email, customerId);

      const validatedToken = await service.validateEmailVerificationToken(rawToken);

      expect(validatedToken).not.toBeNull();
      expect(validatedToken?.email).toBe(email);
      expect(validatedToken?.customerId).toBe(customerId);
      expect(validatedToken?.type).toBe('email_verification');
    });

    it('should reject invalid tokens', async () => {
      const invalidToken = 'invalid_token_12345';

      const result = await service.validatePasswordResetToken(invalidToken);

      expect(result).toBeNull();
    });

    it('should reject tokens of wrong type', async () => {
      const email = 'user@example.com';
      const token = await service.generatePasswordResetToken(email);

      // Try to validate as email verification token
      const result = await service.validateEmailVerificationToken(token);

      expect(result).toBeNull();
    });

    it('should reject expired tokens', async () => {
      // Create service with very short expiration (1ms)
      const shortExpirationService = new TokenService(db, {
        passwordResetExpiration: 1,
      });

      const email = 'user@example.com';
      const token = await shortExpirationService.generatePasswordResetToken(email);

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await shortExpirationService.validatePasswordResetToken(token);

      expect(result).toBeNull();
    });

    it('should reject used tokens', async () => {
      const email = 'user@example.com';
      const token = await service.generatePasswordResetToken(email);

      // Validate once (should work)
      const validatedToken = await service.validatePasswordResetToken(token);
      expect(validatedToken).not.toBeNull();

      // Mark as used
      await service.consumeToken(validatedToken!.id);

      // Try to validate again (should fail)
      const result = await service.validatePasswordResetToken(token);
      expect(result).toBeNull();
    });
  });

  describe('Token Consumption', () => {
    it('should mark token as used', async () => {
      const email = 'user@example.com';
      const token = await service.generatePasswordResetToken(email);

      const validatedToken = await service.validatePasswordResetToken(token);
      expect(validatedToken?.used).toBe(false);

      await service.consumeToken(validatedToken!.id);

      // Token should now be marked as used
      const revalidated = await service.validatePasswordResetToken(token);
      expect(revalidated).toBeNull();
    });
  });

  describe('Rate Limiting', () => {
    it('should detect when rate limit is exceeded', async () => {
      const email = 'user@example.com';

      // Generate 3 tokens (at the limit)
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);

      // Check if rate limit is exceeded (max 3 per hour)
      const exceeded = await service.isRateLimitExceeded(
        email,
        'password_reset',
        3,
        60 * 60 * 1000
      );

      expect(exceeded).toBe(true);
    });

    it('should allow tokens within rate limit', async () => {
      const email = 'user@example.com';

      // Generate 2 tokens (under the limit)
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);

      // Check if rate limit is exceeded (max 3 per hour)
      const exceeded = await service.isRateLimitExceeded(
        email,
        'password_reset',
        3,
        60 * 60 * 1000
      );

      expect(exceeded).toBe(false);
    });

    it('should track rate limits separately by token type', async () => {
      const email = 'user@example.com';
      const customerId = 'customer_123';

      // Generate 3 password reset tokens
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);

      // Password reset should be at limit
      const passwordResetExceeded = await service.isRateLimitExceeded(
        email,
        'password_reset',
        3
      );
      expect(passwordResetExceeded).toBe(true);

      // But email verification should not be at limit
      const emailVerificationExceeded = await service.isRateLimitExceeded(
        email,
        'email_verification',
        3
      );
      expect(emailVerificationExceeded).toBe(false);
    });
  });

  describe('Token Cleanup', () => {
    it('should delete expired tokens', async () => {
      // Create service with very short expiration
      const shortExpirationService = new TokenService(db, {
        passwordResetExpiration: 1,
        emailVerificationExpiration: 1,
      });

      const email = 'user@example.com';
      
      // Generate some tokens
      await shortExpirationService.generatePasswordResetToken(email);
      await shortExpirationService.generatePasswordResetToken(email);
      await shortExpirationService.generateEmailVerificationToken(email, 'customer_123');

      // Wait for tokens to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      // Clean up expired tokens
      const deleted = await shortExpirationService.cleanupExpiredTokens();

      expect(deleted).toBe(3);
    });

    it('should not delete valid tokens', async () => {
      const email = 'user@example.com';
      
      // Generate tokens with normal expiration
      await service.generatePasswordResetToken(email);
      await service.generatePasswordResetToken(email);

      // Clean up (should not delete anything)
      const deleted = await service.cleanupExpiredTokens();

      expect(deleted).toBe(0);
    });
  });

  describe('Token Expiration Times', () => {
    it('should set correct expiration for password reset tokens', async () => {
      const email = 'user@example.com';
      const beforeGeneration = Date.now();
      
      await service.generatePasswordResetToken(email);
      
      const afterGeneration = Date.now();

      // Get the stored token
      const storedTokens = Array.from((db as any).tokens.values());
      const token = storedTokens[0];

      // Expiration should be ~1 hour from now
      const expectedExpiration = beforeGeneration + (60 * 60 * 1000);
      const expirationTime = token.expiresAt.getTime();

      // Allow 1 second tolerance for test execution time
      expect(expirationTime).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(expirationTime).toBeLessThanOrEqual(afterGeneration + (60 * 60 * 1000) + 1000);
    });

    it('should set correct expiration for email verification tokens', async () => {
      const email = 'user@example.com';
      const customerId = 'customer_123';
      const beforeGeneration = Date.now();
      
      await service.generateEmailVerificationToken(email, customerId);
      
      const afterGeneration = Date.now();

      // Get the stored token
      const storedTokens = Array.from((db as any).tokens.values());
      const token = storedTokens[0];

      // Expiration should be ~24 hours from now
      const expectedExpiration = beforeGeneration + (24 * 60 * 60 * 1000);
      const expirationTime = token.expiresAt.getTime();

      // Allow 1 second tolerance
      expect(expirationTime).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(expirationTime).toBeLessThanOrEqual(afterGeneration + (24 * 60 * 60 * 1000) + 1000);
    });
  });

  describe('Custom Configuration', () => {
    it('should respect custom expiration times', async () => {
      const customService = new TokenService(db, {
        passwordResetExpiration: 30 * 60 * 1000, // 30 minutes
      });

      const email = 'user@example.com';
      const beforeGeneration = Date.now();
      
      await customService.generatePasswordResetToken(email);

      const storedTokens = Array.from((db as any).tokens.values());
      const token = storedTokens[0];

      const expectedExpiration = beforeGeneration + (30 * 60 * 1000);
      const expirationTime = token.expiresAt.getTime();

      expect(expirationTime).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(expirationTime).toBeLessThanOrEqual(expectedExpiration + 1000);
    });
  });
});
