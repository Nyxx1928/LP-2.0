/**
 * Security Headers Middleware Tests
 * 
 * These tests verify that our security headers middleware correctly sets
 * all required security headers on responses.
 * 
 * We test:
 * 1. Default configuration (all headers with default values)
 * 2. Custom configuration (overriding specific headers)
 * 3. Middleware execution (next() is called)
 */

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import {
  securityHeaders,
  securityHeadersMiddleware,
  DEFAULT_SECURITY_HEADERS_CONFIG,
} from '../security-headers';

/**
 * Mock response object
 * 
 * We create a mock that tracks which headers were set.
 * This allows us to verify the middleware's behavior without
 * needing a real HTTP server.
 */
function createMockResponse(): MedusaResponse {
  const headers: Record<string, string> = {};

  return {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    getHeaders: () => headers,
  } as unknown as MedusaResponse;
}

/**
 * Mock request object
 * 
 * The security headers middleware doesn't actually use the request,
 * but we need to provide it for the function signature.
 */
function createMockRequest(): MedusaRequest {
  return {} as MedusaRequest;
}

/**
 * Mock next function
 * 
 * This tracks whether next() was called, which is important
 * to ensure the middleware doesn't block the request chain.
 */
function createMockNext(): MedusaNextFunction {
  return jest.fn() as unknown as MedusaNextFunction;
}

describe('Security Headers Middleware', () => {
  /**
   * Test 1: Default Configuration
   * 
   * Verify that all security headers are set with correct default values.
   * This is the most common use case.
   */
  describe('with default configuration', () => {
    it('should set all security headers with default values', () => {
      // Arrange: Create mock objects
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act: Call the middleware
      securityHeadersMiddleware(req, res, next);

      // Assert: Verify all headers are set correctly
      const headers = res.getHeaders();

      // Requirement 13.1: Strict-Transport-Security
      expect(headers['Strict-Transport-Security']).toBe(
        `max-age=${DEFAULT_SECURITY_HEADERS_CONFIG.hstsMaxAge}`
      );

      // Requirement 13.2: X-Content-Type-Options
      expect(headers['X-Content-Type-Options']).toBe('nosniff');

      // Requirement 13.3: X-Frame-Options
      expect(headers['X-Frame-Options']).toBe(
        DEFAULT_SECURITY_HEADERS_CONFIG.xFrameOptions
      );

      // Requirement 13.4: X-XSS-Protection
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');

      // Requirement 13.5: Content-Security-Policy
      expect(headers['Content-Security-Policy']).toBe(
        DEFAULT_SECURITY_HEADERS_CONFIG.contentSecurityPolicy
      );

      // Requirement 13.6: Referrer-Policy
      expect(headers['Referrer-Policy']).toBe(
        DEFAULT_SECURITY_HEADERS_CONFIG.referrerPolicy
      );
    });

    it('should call next() to continue middleware chain', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert: Verify next() was called exactly once
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Test 2: Custom Configuration
   * 
   * Verify that we can override specific headers while keeping
   * defaults for others.
   */
  describe('with custom configuration', () => {
    it('should allow overriding HSTS max-age', () => {
      // Arrange
      const customMaxAge = 86400; // 1 day instead of 1 year
      const middleware = securityHeaders({ hstsMaxAge: customMaxAge });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      middleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Strict-Transport-Security']).toBe(
        `max-age=${customMaxAge}`
      );

      // Other headers should still use defaults
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('should allow overriding Content-Security-Policy', () => {
      // Arrange
      const customCSP = "default-src 'self' cdn.example.com";
      const middleware = securityHeaders({
        contentSecurityPolicy: customCSP,
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      middleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Content-Security-Policy']).toBe(customCSP);

      // Other headers should still use defaults
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('should allow overriding Referrer-Policy', () => {
      // Arrange
      const customPolicy = 'no-referrer';
      const middleware = securityHeaders({
        referrerPolicy: customPolicy,
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      middleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Referrer-Policy']).toBe(customPolicy);
    });

    it('should allow overriding X-Frame-Options', () => {
      // Arrange
      const customFrameOptions = 'SAMEORIGIN';
      const middleware = securityHeaders({
        xFrameOptions: customFrameOptions,
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      middleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['X-Frame-Options']).toBe(customFrameOptions);
    });

    it('should allow overriding multiple headers at once', () => {
      // Arrange
      const customConfig = {
        hstsMaxAge: 86400,
        contentSecurityPolicy: "default-src 'self' cdn.example.com",
        referrerPolicy: 'same-origin',
        xFrameOptions: 'SAMEORIGIN',
      };
      const middleware = securityHeaders(customConfig);
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      middleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Strict-Transport-Security']).toBe(
        `max-age=${customConfig.hstsMaxAge}`
      );
      expect(headers['Content-Security-Policy']).toBe(
        customConfig.contentSecurityPolicy
      );
      expect(headers['Referrer-Policy']).toBe(customConfig.referrerPolicy);
      expect(headers['X-Frame-Options']).toBe(customConfig.xFrameOptions);

      // Headers not in custom config should use defaults
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });
  });

  /**
   * Test 3: Header Values
   * 
   * Verify specific header values match requirements.
   */
  describe('header values', () => {
    it('should set HSTS max-age to 1 year (31536000 seconds)', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
    });

    it('should set X-Content-Type-Options to nosniff', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('should set X-Frame-Options to DENY', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('should set X-XSS-Protection to 1; mode=block', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });

    it('should set Content-Security-Policy to default-src self', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Content-Security-Policy']).toBe("default-src 'self'");
    });

    it('should set Referrer-Policy to strict-origin-when-cross-origin', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert
      const headers = res.getHeaders();
      expect(headers['Referrer-Policy']).toBe(
        'strict-origin-when-cross-origin'
      );
    });
  });

  /**
   * Test 4: Middleware Behavior
   * 
   * Verify the middleware behaves correctly in the request chain.
   */
  describe('middleware behavior', () => {
    it('should not modify the request object', () => {
      // Arrange
      const req = createMockRequest();
      const originalReq = { ...req };
      const res = createMockResponse();
      const next = createMockNext();

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert: Request should be unchanged
      expect(req).toEqual(originalReq);
    });

    it('should set headers before calling next()', () => {
      // Arrange
      const req = createMockRequest();
      const res = createMockResponse();
      let headersWhenNextCalled: Record<string, string> = {};

      const next = jest.fn(() => {
        headersWhenNextCalled = res.getHeaders();
      }) as unknown as MedusaNextFunction;

      // Act
      securityHeadersMiddleware(req, res, next);

      // Assert: Headers should be set when next() is called
      expect(headersWhenNextCalled['Strict-Transport-Security']).toBeDefined();
      expect(headersWhenNextCalled['X-Content-Type-Options']).toBeDefined();
      expect(headersWhenNextCalled['X-Frame-Options']).toBeDefined();
      expect(headersWhenNextCalled['X-XSS-Protection']).toBeDefined();
      expect(headersWhenNextCalled['Content-Security-Policy']).toBeDefined();
      expect(headersWhenNextCalled['Referrer-Policy']).toBeDefined();
    });
  });
});
