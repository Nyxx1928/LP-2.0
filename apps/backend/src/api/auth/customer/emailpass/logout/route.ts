/**
 * Logout Endpoint
 * 
 * This endpoint handles user logout by invalidating their current session.
 * 
 * === WHY POST INSTEAD OF GET? ===
 * 
 * Security Best Practice: Logout MUST be POST, not GET
 * 
 * Why?
 * 1. GET requests can be triggered by:
 *    - Browser prefetching (browser loads links in advance)
 *    - Image tags: <img src="/logout">
 *    - Link previews (messaging apps, social media)
 *    - Browser history/bookmarks
 * 
 * 2. CSRF Protection:
 *    - GET requests are easy to trigger from other sites
 *    - POST requires explicit form submission or JavaScript
 *    - Even with CSRF tokens, POST is safer
 * 
 * 3. HTTP Semantics:
 *    - GET = Read data (should be safe, no side effects)
 *    - POST = Modify state (logout changes authentication state)
 *    - Using correct HTTP methods prevents accidental actions
 * 
 * Real-World Example:
 * - User shares a link: "Check out this product!"
 * - Link is actually: yoursite.com/logout
 * - If logout was GET, clicking the link logs them out!
 * - With POST, the link does nothing (browser shows "Method Not Allowed")
 * 
 * === LOGOUT FLOW ===
 * 
 * 1. Extract session token from cookie
 *    - Token is in HTTP-only cookie (JavaScript can't access it)
 *    - Cookie name: "session_token" (or configured name)
 * 
 * 2. Validate the token
 *    - Verify JWT signature
 *    - Check if session exists in database
 *    - Extract session ID from token
 * 
 * 3. Invalidate the session
 *    - Delete session record from database
 *    - This makes the JWT token useless (database lookup fails)
 * 
 * 4. Clear cookies
 *    - Set session cookie to empty with past expiration
 *    - Clear CSRF token cookie (if present)
 *    - Browser removes cookies immediately
 * 
 * 5. Return success response
 *    - 200 OK with success message
 *    - Frontend can redirect to homepage
 * 
 * === ERROR HANDLING ===
 * 
 * What if there's no session token?
 * - Return 200 OK anyway (idempotent operation)
 * - User is already logged out, mission accomplished!
 * - Don't reveal whether a session existed (security)
 * 
 * What if the token is invalid?
 * - Return 200 OK anyway
 * - Token is invalid = user is not logged in
 * - Logout succeeded (user is logged out)
 * 
 * Why always return 200?
 * - Logout is idempotent (calling it multiple times has same effect)
 * - The goal is "user is logged out" - if they already are, that's fine
 * - Prevents information leakage about session validity
 * 
 * === COOKIE CLEARING ===
 * 
 * To clear a cookie, we set it with:
 * - Empty value: ""
 * - Past expiration: new Date(0) = January 1, 1970
 * - Same path and domain as original cookie
 * 
 * Why same path/domain?
 * - Cookies are scoped by path and domain
 * - To delete a cookie, the clear request must match the original scope
 * - If original: path=/api, domain=.example.com
 * - Clear must use: path=/api, domain=.example.com
 * 
 * === REQUIREMENTS VALIDATION ===
 * 
 * This endpoint satisfies:
 * - Requirement 1.1: Invalidate current session on logout
 * - Requirement 1.2: Clear authentication cookies
 * - Requirement 1.3: Return success response
 * - Requirement 1.4: Use POST method (CSRF protection)
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SessionManager } from "../../../../../lib/session-manager";
import { createAuditLogger } from "../../../../../lib/audit-logger";

/**
 * Cookie configuration
 * 
 * These should match the cookie settings used when creating sessions.
 * In a real application, these would come from environment variables.
 */
const COOKIE_CONFIG = {
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "session_token",
  csrfCookieName: process.env.CSRF_COOKIE_NAME || "csrf_token",
  cookieDomain: process.env.COOKIE_DOMAIN,
  cookiePath: "/",
};

/**
 * POST /auth/customer/emailpass/logout
 * 
 * Logout endpoint - invalidates the current session and clears cookies.
 * 
 * Request:
 * - No body required
 * - Session token in cookie (automatic)
 * 
 * Response:
 * - 200 OK: { message: "Logged out successfully" }
 * - Always returns 200, even if no session (idempotent)
 * 
 * Side Effects:
 * - Session deleted from database
 * - Session cookie cleared
 * - CSRF cookie cleared
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    // Step 1: Get the session token from cookies
    // 
    // In Medusa/Express, cookies are available on req.cookies
    // The cookie was set when the user logged in with HttpOnly flag
    // 
    // Why check if it exists?
    // - User might not be logged in (no cookie)
    // - Cookie might have been manually deleted
    // - This is fine - we'll just return success (already logged out)
    const sessionToken = req.cookies?.[COOKIE_CONFIG.sessionCookieName];

    // Step 2: If there's a session token, invalidate it
    // 
    // We only try to invalidate if a token exists.
    // If no token, user is already logged out - skip to clearing cookies.
    if (sessionToken) {
      // Get database connection from Medusa's dependency injection container
      // 
      // Medusa uses a "container" pattern (similar to Spring/NestJS):
      // - Services are registered in the container
      // - We "resolve" them when needed
      // - This makes testing easier (can inject mocks)
      const logger = req.scope.resolve("logger");
      
      // Get database query builder
      // In Medusa v2, we use the query service to interact with the database
      const query = req.scope.resolve("query");

      // Create SessionManager instance
      // 
      // Why create it here instead of resolving from container?
      // - SessionManager is not a Medusa service (it's our custom class)
      // - We need to pass it dependencies (database, JWT secret)
      // - In a production app, we'd register it as a service
      // 
      // For now, we create it on-demand with the dependencies it needs.
      const jwtSecret = process.env.JWT_SECRET;
      
      if (!jwtSecret) {
        logger.error("JWT_SECRET not configured");
        throw new Error("Server configuration error");
      }

      // Create a database adapter for SessionManager
      // 
      // SessionManager expects a specific interface (SessionDatabase)
      // We need to adapt Medusa's query service to match that interface
      // 
      // This is the "Adapter Pattern" - making incompatible interfaces work together
      const sessionDb = {
        // Find session by ID
        async findSessionById(id: string) {
          const sessions = await query.graph({
            entity: "session",
            fields: ["*"],
            filters: { id },
          });
          return sessions[0] || null;
        },
        
        // Delete a session
        async deleteSession(id: string) {
          await query.graph({
            entity: "session",
            fields: ["id"],
            filters: { id },
          }).then(async (sessions) => {
            if (sessions.length > 0) {
              // In Medusa v2, we use the entity manager to delete
              const manager = req.scope.resolve("manager");
              await manager.delete("session", id);
            }
          });
        },
        
        // Other methods required by SessionDatabase interface
        // (not used in logout, but required by the interface)
        async createSession() { throw new Error("Not implemented"); },
        async findSessionByTokenHash() { throw new Error("Not implemented"); },
        async updateLastActivity() { throw new Error("Not implemented"); },
        async deleteAllSessionsExcept() { throw new Error("Not implemented"); },
        async listActiveSessions() { throw new Error("Not implemented"); },
        async deleteExpiredSessions() { throw new Error("Not implemented"); },
      };

      // Create SessionManager with our database adapter
      const sessionManager = new SessionManager(
        sessionDb as any, // Type assertion because we only implement methods we need
        jwtSecret
      );

      // Validate the session to get the session ID
      // 
      // Why validate first?
      // - We need the session ID to delete the right record
      // - Validation also checks if the token is legitimate
      // - If validation fails, session is already invalid (nothing to delete)
      const session = await sessionManager.validateSession(sessionToken);

      if (session) {
        // Session is valid - invalidate it
        // 
        // This deletes the session record from the database.
        // After this, the JWT token becomes useless (database lookup fails).
        await sessionManager.invalidateSession(session.id);
        
        logger.info(`Session invalidated for customer ${session.customerId}`);
        
        // Log audit event for logout
        const manager = req.scope.resolve("manager");
        const auditLogger = createAuditLogger(manager);
        await auditLogger.logLogout({
          customerId: session.customerId,
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"],
        });
      } else {
        // Session is already invalid or doesn't exist
        // This is fine - user is already logged out
        logger.info("Logout called with invalid or expired session");
      }
    }

    // Step 3: Clear authentication cookies
    // 
    // Even if there was no session or it was invalid, we clear cookies.
    // This ensures the browser doesn't keep sending invalid tokens.
    // 
    // Cookie Clearing Options:
    // - maxAge: 0 = Expire immediately
    // - expires: new Date(0) = January 1, 1970 (definitely in the past)
    // - path: Must match the original cookie's path
    // - domain: Must match the original cookie's domain
    // - httpOnly: Should match original (for consistency)
    // - secure: Should match original (for consistency)
    // - sameSite: Should match original (for consistency)
    
    // Clear session cookie
    res.cookie(COOKIE_CONFIG.sessionCookieName, "", {
      maxAge: 0,
      expires: new Date(0),
      path: COOKIE_CONFIG.cookiePath,
      domain: COOKIE_CONFIG.cookieDomain,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    // Clear CSRF token cookie (if it exists)
    // 
    // CSRF tokens are tied to sessions, so we clear them on logout.
    // This prevents the old CSRF token from being used after logout.
    res.cookie(COOKIE_CONFIG.csrfCookieName, "", {
      maxAge: 0,
      expires: new Date(0),
      path: COOKIE_CONFIG.cookiePath,
      domain: COOKIE_CONFIG.cookieDomain,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    // Step 4: Return success response
    // 
    // We always return 200 OK, even if:
    // - There was no session token
    // - The token was invalid
    // - The session was already deleted
    // 
    // Why? Logout is idempotent:
    // - Goal: User is logged out
    // - If they're already logged out, goal achieved!
    // - No need to return an error
    // 
    // This also prevents information leakage:
    // - Attacker can't tell if a session existed
    // - Attacker can't tell if a token was valid
    res.status(200).json({
      message: "Logged out successfully",
    });

  } catch (error) {
    // Error handling
    // 
    // If something goes wrong (database error, etc.), we log it but still
    // return success to the user. Why?
    // 
    // 1. User Experience: User clicked logout, they expect to be logged out
    // 2. Security: Don't reveal internal errors to potential attackers
    // 3. Cookies Cleared: Even if database delete failed, cookies are cleared
    // 
    // The user is effectively logged out (no cookies = no authentication).
    // The database cleanup can be handled by a background job if needed.
    const logger = req.scope.resolve("logger");
    logger.error("Error during logout:", error);

    // Still clear cookies and return success
    res.cookie(COOKIE_CONFIG.sessionCookieName, "", {
      maxAge: 0,
      expires: new Date(0),
      path: COOKIE_CONFIG.cookiePath,
      domain: COOKIE_CONFIG.cookieDomain,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.cookie(COOKIE_CONFIG.csrfCookieName, "", {
      maxAge: 0,
      expires: new Date(0),
      path: COOKIE_CONFIG.cookiePath,
      domain: COOKIE_CONFIG.cookieDomain,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.status(200).json({
      message: "Logged out successfully",
    });
  }
}
