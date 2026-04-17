/**
 * CSRF Middleware Example for Medusa v2
 * 
 * This file demonstrates how to integrate CSRF protection into Medusa routes.
 * 
 * === INTEGRATION STEPS ===
 * 
 * 1. Create a CSRF token endpoint (GET /auth/csrf-token)
 * 2. Create validation middleware (validateCSRF)
 * 3. Apply middleware to protected routes
 * 4. Update frontend to fetch and include tokens
 * 
 * === WHEN TO USE CSRF PROTECTION ===
 * 
 * Apply CSRF protection to:
 * - Login/Registration endpoints
 * - Password reset endpoints
 * - Account update endpoints
 * - Any state-changing operation (POST, PUT, PATCH, DELETE)
 * 
 * Do NOT apply to:
 * - Read-only endpoints (GET)
 * - Public API endpoints (no authentication)
 * - Webhook endpoints (use signature verification instead)
 */

import { MedusaRequest, MedusaResponse } from '@medusajs/medusa';
import { csrfProtection } from './csrf-protection';

/**
 * CSRF Token Generation Endpoint
 * 
 * This endpoint generates a new CSRF token and sends it to the client
 * in both a cookie and the response body.
 * 
 * Frontend should call this before submitting forms that need CSRF protection.
 * 
 * Route: GET /auth/csrf-token
 */
export async function getCSRFToken(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    // Generate a new CSRF token
    const token = await csrfProtection.generateToken();
    
    /**
     * Set token in cookie with security flags
     * 
     * httpOnly: true
     * - JavaScript cannot access the cookie
     * - Prevents XSS attacks from stealing the token
     * 
     * secure: true (in production)
     * - Cookie only sent over HTTPS
     * - Prevents man-in-the-middle attacks
     * 
     * sameSite: 'strict'
     * - Browser never sends cookie in cross-site requests
     * - First line of defense against CSRF
     * 
     * maxAge: 3600000 (1 hour)
     * - Cookie expires after 1 hour
     * - Matches token expiration in Redis
     */
    res.cookie('csrf-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000, // 1 hour in milliseconds
      path: '/', // Available to all routes
    });
    
    /**
     * Also return token in response body
     * 
     * Why both cookie and body?
     * - Cookie: Browser sends automatically in subsequent requests
     * - Body: Frontend stores in memory to add to request headers
     * 
     * This is the "double-submit" pattern.
     */
    res.status(200).json({
      token,
      expires_in: 3600, // seconds
    });
    
  } catch (error) {
    console.error('Failed to generate CSRF token:', error);
    res.status(500).json({
      error: {
        type: 'internal_error',
        message: 'Failed to generate CSRF token',
      },
    });
  }
}

/**
 * CSRF Validation Middleware
 * 
 * This middleware validates CSRF tokens on incoming requests.
 * It should be applied to all state-changing endpoints.
 * 
 * How it works:
 * 1. Extract token from cookie (browser sends automatically)
 * 2. Extract token from header (frontend must add explicitly)
 * 3. Validate: cookie token === header token
 * 4. If valid: continue to route handler
 * 5. If invalid: return 403 Forbidden
 */
export async function validateCSRF(
  req: MedusaRequest,
  res: MedusaResponse,
  next: () => void
): Promise<void> {
  try {
    /**
     * Skip CSRF validation for safe methods
     * 
     * Safe methods (GET, HEAD, OPTIONS):
     * - Read-only operations
     * - Don't change server state
     * - Not vulnerable to CSRF
     * 
     * Unsafe methods (POST, PUT, PATCH, DELETE):
     * - Change server state
     * - Vulnerable to CSRF
     * - Require CSRF protection
     */
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    
    /**
     * Extract tokens from request
     * 
     * Cookie token:
     * - Sent automatically by browser
     * - Attacker can trigger this (but can't read it)
     * 
     * Header token:
     * - Must be explicitly added by frontend
     * - Attacker CANNOT add this (Same-Origin Policy)
     */
    const cookieToken = req.cookies?.['csrf-token'];
    const headerToken = req.headers['x-csrf-token'] as string | undefined;
    
    /**
     * Validate tokens
     * 
     * This checks:
     * 1. Both tokens are present
     * 2. Both tokens have the same length
     * 3. Cookie token exists in Redis (not expired)
     * 4. Cookie token === header token (constant-time comparison)
     */
    const isValid = await csrfProtection.validateToken(cookieToken, headerToken);
    
    if (!isValid) {
      /**
       * Return 403 Forbidden
       * 
       * Why 403 instead of 401?
       * - 401: Authentication failed (who you are)
       * - 403: Authorization failed (what you can do)
       * - CSRF is about authorization (proving intent)
       * 
       * Generic error message:
       * - Don't reveal why validation failed
       * - Prevents information leakage
       * - Attacker can't learn from error messages
       */
      return res.status(403).json({
        error: {
          type: 'csrf_error',
          code: 'INVALID_CSRF_TOKEN',
          message: 'Invalid or missing CSRF token',
        },
      });
    }
    
    // Token is valid, continue to route handler
    next();
    
  } catch (error) {
    console.error('CSRF validation error:', error);
    
    /**
     * Fail securely on errors
     * 
     * If something goes wrong (Redis down, etc.):
     * - Deny the request (fail closed)
     * - Better to block legitimate users than allow attacks
     * - Users can retry when system is healthy
     */
    res.status(500).json({
      error: {
        type: 'internal_error',
        message: 'Failed to validate CSRF token',
      },
    });
  }
}

/**
 * Example: Applying CSRF Protection to Routes
 * 
 * This shows how to integrate CSRF protection into Medusa routes.
 */

// Example 1: Login endpoint with CSRF protection
export async function loginWithCSRF(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // CSRF validation happens in middleware (before this function)
  // If we reach here, CSRF token is valid
  
  const { email, password } = req.body;
  
  // ... login logic ...
  
  res.status(200).json({
    message: 'Login successful',
  });
}

// Example 2: Registration endpoint with CSRF protection
export async function registerWithCSRF(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // CSRF validation happens in middleware
  
  const { email, password, first_name, last_name } = req.body;
  
  // ... registration logic ...
  
  res.status(201).json({
    message: 'Registration successful',
  });
}

/**
 * Example: Route Configuration
 * 
 * This shows how to configure routes with CSRF protection.
 * 
 * In your Medusa route file (e.g., src/api/auth/customer/emailpass/route.ts):
 */

/*
import { validateCSRF, getCSRFToken, loginWithCSRF, registerWithCSRF } from './csrf-middleware-example';

export const GET = [
  // CSRF token endpoint (no validation needed)
  {
    path: '/auth/csrf-token',
    handler: getCSRFToken,
  },
];

export const POST = [
  // Login endpoint with CSRF protection
  {
    path: '/auth/customer/emailpass',
    middlewares: [validateCSRF], // Apply CSRF validation
    handler: loginWithCSRF,
  },
  
  // Registration endpoint with CSRF protection
  {
    path: '/auth/customer/emailpass/register',
    middlewares: [validateCSRF], // Apply CSRF validation
    handler: registerWithCSRF,
  },
];
*/

/**
 * Example: Frontend Integration
 * 
 * This shows how the frontend should use CSRF tokens.
 */

/*
// Step 1: Fetch CSRF token before form submission
async function fetchCSRFToken() {
  const response = await fetch('/auth/csrf-token', {
    credentials: 'include', // Include cookies
  });
  
  const { token } = await response.json();
  return token;
}

// Step 2: Include token in request
async function login(email: string, password: string) {
  // Get CSRF token
  const csrfToken = await fetchCSRFToken();
  
  // Make request with token in header
  const response = await fetch('/auth/customer/emailpass', {
    method: 'POST',
    credentials: 'include', // Include cookies (for CSRF cookie)
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken, // Add token to header
    },
    body: JSON.stringify({ email, password }),
  });
  
  if (response.status === 403) {
    // CSRF validation failed
    // Fetch new token and retry
    console.error('CSRF token invalid, fetching new token...');
    return login(email, password); // Retry with new token
  }
  
  return response.json();
}

// Step 3: Handle token expiration
// Option A: Fetch new token before each request
// Option B: Cache token and refresh on 403 error
// Option C: Refresh token periodically (e.g., every 30 minutes)
*/

/**
 * Testing CSRF Protection
 * 
 * Manual testing steps:
 */

/*
1. Test valid token:
   - GET /auth/csrf-token (get token)
   - POST /auth/customer/emailpass with token in header
   - Should succeed (200 OK)

2. Test missing token:
   - POST /auth/customer/emailpass without token
   - Should fail (403 Forbidden)

3. Test invalid token:
   - POST /auth/customer/emailpass with fake token
   - Should fail (403 Forbidden)

4. Test expired token:
   - GET /auth/csrf-token (get token)
   - Wait 1 hour
   - POST /auth/customer/emailpass with old token
   - Should fail (403 Forbidden)

5. Test mismatched tokens:
   - GET /auth/csrf-token (get token1)
   - Manually set different token in header
   - POST /auth/customer/emailpass
   - Should fail (403 Forbidden)

6. Test cross-site request:
   - Create malicious HTML page
   - Try to submit form to your API
   - Should fail (cookie not sent due to SameSite=Strict)
*/

/**
 * Monitoring and Alerting
 * 
 * Track these metrics for security monitoring:
 */

/*
1. CSRF validation failures per minute
   - Alert if > 100/min (possible attack)

2. CSRF token generation rate
   - Alert if > 1000/min (possible DoS)

3. CSRF validation success rate
   - Alert if < 95% (possible misconfiguration)

4. Redis connection errors
   - Alert immediately (CSRF protection down)

5. Token expiration rate
   - Monitor for proper cleanup
*/

/**
 * Troubleshooting Common Issues
 */

/*
Issue: "Invalid or missing CSRF token" on every request
Solution:
- Check frontend is fetching token before request
- Check frontend is including token in X-CSRF-Token header
- Check cookies are enabled in browser
- Check SameSite attribute is compatible with your setup

Issue: Token expires too quickly
Solution:
- Increase tokenExpiration in CSRFConfig
- Implement token refresh on frontend
- Cache token and refresh on 403 error

Issue: CSRF protection breaks in development
Solution:
- Ensure frontend and backend are on same origin
- Use localhost (not 127.0.0.1) for both
- Set secure: false in development
- Check CORS configuration allows credentials

Issue: Redis connection errors
Solution:
- Check Redis is running
- Check REDIS_URL environment variable
- Check network connectivity
- Implement Redis connection retry logic
*/
