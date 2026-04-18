/**
 * SessionManager Unit Tests
 * 
 * These tests verify the SessionManager works correctly without needing
 * a real database. We use a mock (fake) database that stores data in memory.
 * 
 * Test Structure:
 * - describe(): Groups related tests
 * - it(): Individual test case
 * - expect(): Assertion (what we expect to be true)
 * 
 * Why mock the database?
 * - Tests run faster (no database connection)
 * - Tests are isolated (no shared state between tests)
 * - Tests are deterministic (no database connection issues)
 */

import {
  SessionManager,
  SessionData,
  SessionDatabase,
  DeviceInfo,
} from '../session-manager';
import jwt from 'jsonwebtoken';

/**
 * Mock Database Implementation
 * 
 * This is an in-memory database for testing.
 * It implements the SessionDatabase interface without needing a real database.
 * 
 * How it works:
 * - Uses a Map to store sessions (like a JavaScript object but better)
 * - Generates sequential IDs (1, 2, 3, ...)
 * - All operations are synchronous (no real I/O)
 */
class MockSessionDatabase implements SessionDatabase {
  private sessions: Map<string, SessionData> = new Map();

  async createSession(
    session: Omit<SessionData, 'createdAt' | 'lastActivityAt'>
  ): Promise<SessionData> {
    const now = new Date();
    const fullSession: SessionData = {
      ...session,
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(session.id, fullSession);
    return fullSession;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionData | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }
    return null;
  }

  async findSessionById(id: string): Promise<SessionData | null> {
    return this.sessions.get(id) || null;
  }

  async updateLastActivity(id: string, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivityAt = new Date();
      session.expiresAt = expiresAt;
    }
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async deleteAllSessionsExcept(
    customerId: string,
    exceptSessionId?: string
  ): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.customerId === customerId && id !== exceptSessionId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  async listActiveSessions(customerId: string): Promise<SessionData[]> {
    const now = new Date();
    return Array.from(this.sessions.values()).filter(
      (session) =>
        session.customerId === customerId && session.expiresAt > now
    );
  }

  async deleteExpiredSessions(): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  // Helper method for tests
  clear(): void {
    this.sessions.clear();
  }
}

/**
 * Test Suite
 */
describe('SessionManager', () => {
  let manager: SessionManager;
  let db: MockSessionDatabase;
  const jwtSecret = 'test-secret-key-at-least-32-characters-long';

  // Run before each test - creates fresh instances
  beforeEach(() => {
    db = new MockSessionDatabase();
    manager = new SessionManager(db, jwtSecret);
  });

  /**
   * Constructor Tests
   */
  describe('Constructor', () => {
    it('should throw error if JWT secret is too short', () => {
      expect(() => {
        new SessionManager(db, 'short');
      }).toThrow('JWT secret must be at least 32 characters');
    });

    it('should accept valid JWT secret', () => {
      expect(() => {
        new SessionManager(db, jwtSecret);
      }).not.toThrow();
    });

    it('should accept custom configuration', () => {
      const customManager = new SessionManager(db, jwtSecret, {
        sessionTimeout: 60 * 60 * 1000, // 1 hour
        rememberMeDuration: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      expect(customManager).toBeDefined();
    });
  });

  /**
   * Create Session Tests
   */
  describe('createSession', () => {
    it('should create a session with valid JWT token', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      // Token should be a non-empty string
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      // Token should be a valid JWT
      const decoded = jwt.verify(token, jwtSecret) as any;
      expect(decoded.customerId).toBe('customer_123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.rememberMe).toBe(false);
      expect(decoded.sessionId).toBeTruthy();
    });

    it('should store session in database', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded = jwt.decode(token) as any;
      const session = await db.findSessionById(decoded.sessionId);

      expect(session).toBeTruthy();
      expect(session?.customerId).toBe('customer_123');
      expect(session?.email).toBe('test@example.com');
      expect(session?.rememberMe).toBe(false);
    });

    it('should set correct expiration for normal session (24 hours)', async () => {
      const beforeCreate = Date.now();
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );
      const afterCreate = Date.now();

      const decoded = jwt.decode(token) as any;
      const session = await db.findSessionById(decoded.sessionId);

      // Expiration should be approximately 24 hours from now
      const expectedExpiration = 24 * 60 * 60 * 1000; // 24 hours in ms
      const actualExpiration =
        session!.expiresAt.getTime() - beforeCreate;

      // Allow 1 second tolerance for test execution time
      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(actualExpiration).toBeLessThanOrEqual(
        expectedExpiration + (afterCreate - beforeCreate) + 1000
      );
    });

    it('should set correct expiration for remember me session (30 days)', async () => {
      const beforeCreate = Date.now();
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        true // Remember me
      );
      const afterCreate = Date.now();

      const decoded = jwt.decode(token) as any;
      const session = await db.findSessionById(decoded.sessionId);

      // Expiration should be approximately 30 days from now
      const expectedExpiration = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
      const actualExpiration =
        session!.expiresAt.getTime() - beforeCreate;

      // Allow 1 second tolerance
      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(actualExpiration).toBeLessThanOrEqual(
        expectedExpiration + (afterCreate - beforeCreate) + 1000
      );
    });

    it('should store device info when provided', async () => {
      const deviceInfo: DeviceInfo = {
        browser: 'Chrome',
        os: 'Windows',
        device: 'Desktop',
      };

      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false,
        deviceInfo
      );

      const decoded = jwt.decode(token) as any;
      const session = await db.findSessionById(decoded.sessionId);

      expect(session?.deviceInfo).toEqual(deviceInfo);
    });

    it('should store IP address and user agent when provided', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false,
        undefined,
        '192.168.1.1',
        'Mozilla/5.0 ...'
      );

      const decoded = jwt.decode(token) as any;
      const session = await db.findSessionById(decoded.sessionId);

      expect(session?.ipAddress).toBe('192.168.1.1');
      expect(session?.userAgent).toBe('Mozilla/5.0 ...');
    });

    it('should generate unique session IDs', async () => {
      const token1 = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );
      const token2 = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded1 = jwt.decode(token1) as any;
      const decoded2 = jwt.decode(token2) as any;

      expect(decoded1.sessionId).not.toBe(decoded2.sessionId);
    });
  });

  /**
   * Validate Session Tests
   */
  describe('validateSession', () => {
    it('should validate a valid session', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const session = await manager.validateSession(token);

      expect(session).toBeTruthy();
      expect(session?.customerId).toBe('customer_123');
      expect(session?.email).toBe('test@example.com');
    });

    it('should reject invalid JWT signature', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      // Tamper with the token (change last character)
      const tamperedToken = token.slice(0, -1) + 'X';

      const session = await manager.validateSession(tamperedToken);
      expect(session).toBeNull();
    });

    it('should reject expired JWT', async () => {
      // Create manager with very short expiration (1ms)
      const shortExpirationManager = new SessionManager(db, jwtSecret, {
        sessionTimeout: 1,
      });

      const token = await shortExpirationManager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = await shortExpirationManager.validateSession(token);
      expect(session).toBeNull();
    });

    it('should reject session that does not exist in database', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      // Delete session from database
      const decoded = jwt.decode(token) as any;
      await db.deleteSession(decoded.sessionId);

      const session = await manager.validateSession(token);
      expect(session).toBeNull();
    });

    it('should reject malformed JWT', async () => {
      const session = await manager.validateSession('not-a-valid-jwt');
      expect(session).toBeNull();
    });

    it('should reject empty token', async () => {
      const session = await manager.validateSession('');
      expect(session).toBeNull();
    });
  });

  /**
   * Extend Session Tests
   */
  describe('extendSession', () => {
    it('should extend session expiration', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded = jwt.decode(token) as any;
      const sessionBefore = await db.findSessionById(decoded.sessionId);
      const expiresAtBefore = sessionBefore!.expiresAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Extend session
      await manager.extendSession(decoded.sessionId);

      const sessionAfter = await db.findSessionById(decoded.sessionId);
      const expiresAtAfter = sessionAfter!.expiresAt.getTime();

      // Expiration should be later than before
      expect(expiresAtAfter).toBeGreaterThan(expiresAtBefore);
    });

    it('should update last activity timestamp', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded = jwt.decode(token) as any;
      const sessionBefore = await db.findSessionById(decoded.sessionId);
      const lastActivityBefore = sessionBefore!.lastActivityAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Extend session
      await manager.extendSession(decoded.sessionId);

      const sessionAfter = await db.findSessionById(decoded.sessionId);
      const lastActivityAfter = sessionAfter!.lastActivityAt.getTime();

      // Last activity should be later than before
      expect(lastActivityAfter).toBeGreaterThan(lastActivityBefore);
    });

    it('should handle non-existent session gracefully', async () => {
      // Should not throw error
      await expect(
        manager.extendSession('non-existent-session')
      ).resolves.not.toThrow();
    });

    it('should respect remember me duration when extending', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        true // Remember me
      );

      const decoded = jwt.decode(token) as any;
      const beforeExtend = Date.now();
      
      await manager.extendSession(decoded.sessionId);
      
      const session = await db.findSessionById(decoded.sessionId);
      const expectedExpiration = 30 * 24 * 60 * 60 * 1000; // 30 days
      const actualExpiration = session!.expiresAt.getTime() - beforeExtend;

      // Should be approximately 30 days, not 24 hours
      expect(actualExpiration).toBeGreaterThan(25 * 24 * 60 * 60 * 1000); // At least 25 days
    });
  });

  /**
   * Invalidate Session Tests
   */
  describe('invalidateSession', () => {
    it('should delete session from database', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded = jwt.decode(token) as any;
      
      // Session should exist
      let session = await db.findSessionById(decoded.sessionId);
      expect(session).toBeTruthy();

      // Invalidate session
      await manager.invalidateSession(decoded.sessionId);

      // Session should no longer exist
      session = await db.findSessionById(decoded.sessionId);
      expect(session).toBeNull();
    });

    it('should make token invalid after invalidation', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const decoded = jwt.decode(token) as any;
      await manager.invalidateSession(decoded.sessionId);

      // Token should no longer validate
      const session = await manager.validateSession(token);
      expect(session).toBeNull();
    });

    it('should handle non-existent session gracefully', async () => {
      // Should not throw error
      await expect(
        manager.invalidateSession('non-existent-session')
      ).resolves.not.toThrow();
    });
  });

  /**
   * Invalidate All Sessions Tests
   */
  describe('invalidateAllSessions', () => {
    it('should delete all sessions for a customer', async () => {
      // Create multiple sessions for same customer
      await manager.createSession('customer_123', 'test@example.com', false);
      await manager.createSession('customer_123', 'test@example.com', false);
      await manager.createSession('customer_123', 'test@example.com', false);

      // Create session for different customer
      await manager.createSession('customer_456', 'other@example.com', false);

      const count = await manager.invalidateAllSessions('customer_123');

      expect(count).toBe(3);

      // Customer 123 should have no sessions
      const sessions123 = await db.listActiveSessions('customer_123');
      expect(sessions123).toHaveLength(0);

      // Customer 456 should still have their session
      const sessions456 = await db.listActiveSessions('customer_456');
      expect(sessions456).toHaveLength(1);
    });

    it('should keep excepted session when provided', async () => {
      // Create multiple sessions
      const token1 = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );
      await manager.createSession('customer_123', 'test@example.com', false);
      await manager.createSession('customer_123', 'test@example.com', false);

      const decoded1 = jwt.decode(token1) as any;

      const count = await manager.invalidateAllSessions(
        'customer_123',
        decoded1.sessionId
      );

      expect(count).toBe(2); // Only 2 deleted, 1 kept

      // Should still have 1 session
      const sessions = await db.listActiveSessions('customer_123');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(decoded1.sessionId);
    });

    it('should return 0 if customer has no sessions', async () => {
      const count = await manager.invalidateAllSessions('customer_999');
      expect(count).toBe(0);
    });
  });

  /**
   * List Active Sessions Tests
   */
  describe('listActiveSessions', () => {
    it('should return all active sessions for a customer', async () => {
      await manager.createSession('customer_123', 'test@example.com', false);
      await manager.createSession('customer_123', 'test@example.com', false);
      await manager.createSession('customer_456', 'other@example.com', false);

      const sessions = await manager.listActiveSessions('customer_123');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].customerId).toBe('customer_123');
      expect(sessions[1].customerId).toBe('customer_123');
    });

    it('should not return expired sessions', async () => {
      // Create manager with very short expiration
      const shortExpirationManager = new SessionManager(db, jwtSecret, {
        sessionTimeout: 1,
      });

      await shortExpirationManager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      // Wait for session to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessions = await manager.listActiveSessions('customer_123');
      expect(sessions).toHaveLength(0);
    });

    it('should return empty array if customer has no sessions', async () => {
      const sessions = await manager.listActiveSessions('customer_999');
      expect(sessions).toHaveLength(0);
    });
  });

  /**
   * Cleanup Expired Sessions Tests
   */
  describe('cleanupExpiredSessions', () => {
    it('should delete expired sessions', async () => {
      // Create manager with very short expiration
      const shortExpirationManager = new SessionManager(db, jwtSecret, {
        sessionTimeout: 1,
      });

      // Create expired sessions
      await shortExpirationManager.createSession(
        'customer_123',
        'test@example.com',
        false
      );
      await shortExpirationManager.createSession(
        'customer_456',
        'other@example.com',
        false
      );

      // Create non-expired session
      await manager.createSession('customer_789', 'active@example.com', false);

      // Wait for sessions to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = await manager.cleanupExpiredSessions();

      expect(count).toBe(2);

      // Only active session should remain
      const allSessions = await db.listActiveSessions('customer_789');
      expect(allSessions).toHaveLength(1);
    });

    it('should return 0 if no expired sessions', async () => {
      await manager.createSession('customer_123', 'test@example.com', false);

      const count = await manager.cleanupExpiredSessions();
      expect(count).toBe(0);
    });
  });

  /**
   * Extract Session ID Tests
   */
  describe('extractSessionId', () => {
    it('should extract session ID from valid token', async () => {
      const token = await manager.createSession(
        'customer_123',
        'test@example.com',
        false
      );

      const sessionId = manager.extractSessionId(token);
      const decoded = jwt.decode(token) as any;

      expect(sessionId).toBe(decoded.sessionId);
    });

    it('should return null for invalid token', () => {
      const sessionId = manager.extractSessionId('invalid-token');
      expect(sessionId).toBeNull();
    });

    it('should return null for empty token', () => {
      const sessionId = manager.extractSessionId('');
      expect(sessionId).toBeNull();
    });
  });
});
