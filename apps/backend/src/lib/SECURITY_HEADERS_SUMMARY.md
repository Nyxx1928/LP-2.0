# Security Headers Middleware - Summary

## What We Built

A comprehensive security headers middleware that adds 6 critical HTTP security headers to all API responses, protecting users from common web vulnerabilities.

## The 6 Security Headers

### 1. Strict-Transport-Security (HSTS)
**What it does:** Forces browsers to only access the site over HTTPS for 1 year.

**Protects against:** Man-in-the-Middle (MITM) attacks where attackers intercept HTTP traffic.

**Example:**
```
Strict-Transport-Security: max-age=31536000
```

**Real-world impact:** Even if a user types `http://yoursite.com`, the browser automatically upgrades to `https://yoursite.com`, preventing attackers from intercepting the initial HTTP request.

### 2. X-Content-Type-Options
**What it does:** Prevents browsers from guessing file types (MIME sniffing).

**Protects against:** MIME sniffing attacks where malicious files disguised as images execute as JavaScript.

**Example:**
```
X-Content-Type-Options: nosniff
```

**Real-world impact:** If a user uploads a file named "profile.jpg" that contains JavaScript, the browser won't execute it as a script.

### 3. X-Frame-Options
**What it does:** Prevents the page from being embedded in iframes on other sites.

**Protects against:** Clickjacking attacks where attackers overlay invisible iframes to trick users into clicking malicious buttons.

**Example:**
```
X-Frame-Options: DENY
```

**Real-world impact:** Attackers can't embed your login page in an invisible iframe on their malicious site to steal credentials.

### 4. X-XSS-Protection
**What it does:** Enables the browser's built-in XSS filter and blocks pages if attacks are detected.

**Protects against:** Cross-Site Scripting (XSS) attacks where malicious scripts are injected into your site.

**Example:**
```
X-XSS-Protection: 1; mode=block
```

**Real-world impact:** If an attacker tries to inject `<script>alert('XSS')</script>` into a URL parameter, the browser blocks the page from loading.

### 5. Content-Security-Policy (CSP)
**What it does:** Defines a whitelist of sources from which resources (scripts, styles, images) can be loaded.

**Protects against:** XSS attacks, data injection, and malicious resource loading.

**Example:**
```
Content-Security-Policy: default-src 'self'
```

**Real-world impact:** Even if an attacker injects `<script src="https://evil.com/malware.js"></script>`, the browser blocks it because `evil.com` isn't in the whitelist.

### 6. Referrer-Policy
**What it does:** Controls how much information is sent in the Referer header when navigating to other sites.

**Protects against:** Information leakage through URLs containing sensitive data.

**Example:**
```
Referrer-Policy: strict-origin-when-cross-origin
```

**Real-world impact:** If a user visits `/account?id=12345&balance=50000` and clicks an external link, only the origin (`https://yoursite.com`) is sent, not the full URL with sensitive parameters.

## How to Use

### Basic Usage (Recommended)

Apply to all routes using the default configuration:

```typescript
// apps/backend/src/api/middlewares.ts
import { securityHeadersMiddleware } from '../lib/security-headers';

export default defineMiddlewares({
  routes: [
    {
      matcher: '*', // Apply to all routes
      middlewares: [securityHeadersMiddleware],
    },
  ],
});
```

### Custom Configuration

Override specific headers for your needs:

```typescript
import { securityHeaders } from '../lib/security-headers';

// Custom configuration for development
const devSecurityHeaders = securityHeaders({
  contentSecurityPolicy: "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
  hstsMaxAge: 0, // Disable HSTS in development
});

// Custom configuration for production with CDN
const prodSecurityHeaders = securityHeaders({
  contentSecurityPolicy: "default-src 'self' cdn.example.com",
  referrerPolicy: 'no-referrer', // Maximum privacy
});

export default defineMiddlewares({
  routes: [
    {
      matcher: '*',
      middlewares: [
        process.env.NODE_ENV === 'production'
          ? prodSecurityHeaders
          : devSecurityHeaders,
      ],
    },
  ],
});
```

### Apply to Specific Routes

If you only want security headers on certain routes:

```typescript
export default defineMiddlewares({
  routes: [
    {
      matcher: '/auth/*', // Only authentication routes
      middlewares: [securityHeadersMiddleware],
    },
    {
      matcher: '/store/*', // Only store routes
      middlewares: [securityHeadersMiddleware],
    },
  ],
});
```

## Configuration Options

All options are optional. If not provided, secure defaults are used.

```typescript
interface SecurityHeadersConfig {
  // HSTS max-age in seconds (default: 31536000 = 1 year)
  hstsMaxAge?: number;

  // Content-Security-Policy directive (default: "default-src 'self'")
  contentSecurityPolicy?: string;

  // Referrer-Policy value (default: "strict-origin-when-cross-origin")
  referrerPolicy?: string;

  // X-Frame-Options value (default: "DENY")
  xFrameOptions?: string;
}
```

## Testing

The middleware includes comprehensive unit tests covering:

- ✅ All 6 headers are set with correct default values
- ✅ Custom configuration overrides work correctly
- ✅ Middleware calls next() to continue the request chain
- ✅ Headers are set before next() is called
- ✅ Request object is not modified

Run tests:
```bash
npm test -- security-headers.unit.spec.ts
```

## Requirements Satisfied

This implementation satisfies all requirements from the spec:

- ✅ **Requirement 13.1:** Strict-Transport-Security with max-age of 31536000 seconds
- ✅ **Requirement 13.2:** X-Content-Type-Options set to nosniff
- ✅ **Requirement 13.3:** X-Frame-Options set to DENY
- ✅ **Requirement 13.4:** X-XSS-Protection set to 1; mode=block
- ✅ **Requirement 13.5:** Content-Security-Policy with appropriate directives
- ✅ **Requirement 13.6:** Referrer-Policy set to strict-origin-when-cross-origin

## Security Best Practices

### 1. Apply Globally
Security headers should be applied to ALL routes, not just authentication endpoints. This ensures consistent protection across your entire application.

### 2. Test in Development
Some headers (especially CSP) can break functionality if configured incorrectly. Test thoroughly in development before deploying to production.

### 3. Monitor CSP Violations
Consider adding CSP reporting to detect violations:
```typescript
contentSecurityPolicy: "default-src 'self'; report-uri /csp-violation-report"
```

### 4. Use HSTS Preload
For maximum security, consider adding your domain to the HSTS preload list:
```typescript
hstsMaxAge: 31536000, // Must be at least 1 year for preload
```
Then submit your domain at https://hstspreload.org/

### 5. Adjust for Your Stack
If you use CDNs, analytics, or third-party scripts, adjust CSP accordingly:
```typescript
// Example for Google Analytics
contentSecurityPolicy: 
  "default-src 'self'; " +
  "script-src 'self' www.google-analytics.com; " +
  "img-src 'self' www.google-analytics.com"
```

## Common Issues and Solutions

### Issue: CSP blocks inline scripts
**Problem:** Your frontend uses inline `<script>` tags or `onclick` attributes.

**Solution:** 
1. Move scripts to external files (recommended)
2. Use nonces or hashes (advanced)
3. Temporarily allow unsafe-inline (not recommended for production)

### Issue: HSTS prevents HTTP access
**Problem:** You need to support HTTP for development or testing.

**Solution:** Use different configurations for dev/prod:
```typescript
hstsMaxAge: process.env.NODE_ENV === 'production' ? 31536000 : 0
```

### Issue: X-Frame-Options breaks legitimate embeds
**Problem:** You need to embed your pages in iframes on your own site.

**Solution:** Use SAMEORIGIN instead of DENY:
```typescript
xFrameOptions: 'SAMEORIGIN'
```

### Issue: Referrer-Policy breaks analytics
**Problem:** Your analytics tool needs full referrer information.

**Solution:** Use a less restrictive policy:
```typescript
referrerPolicy: 'strict-origin-when-cross-origin' // Default, good balance
// or
referrerPolicy: 'unsafe-url' // Least restrictive, use with caution
```

## Further Reading

- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [MDN Web Docs: HTTP Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers)
- [Content Security Policy Reference](https://content-security-policy.com/)
- [HSTS Preload List](https://hstspreload.org/)

## What We Learned

### Key Concepts

1. **Defense in Depth:** Security headers are one layer in a multi-layered security strategy. They work alongside input validation, output encoding, CSRF protection, and rate limiting.

2. **Browser Security Model:** Modern browsers have powerful security features, but they need to be explicitly enabled via HTTP headers. Without these headers, browsers use permissive defaults for backward compatibility.

3. **Middleware Pattern:** Security headers are implemented as middleware that runs for every request, adding headers to every response. This ensures consistent protection across the entire application.

4. **Configuration vs Defaults:** The middleware provides secure defaults but allows customization for different environments and use cases.

### Why Each Header Matters

- **HSTS:** Prevents downgrade attacks where HTTPS is stripped to HTTP
- **X-Content-Type-Options:** Prevents MIME confusion attacks
- **X-Frame-Options:** Prevents clickjacking attacks
- **X-XSS-Protection:** Provides legacy XSS protection for older browsers
- **Content-Security-Policy:** Modern, powerful protection against XSS and injection
- **Referrer-Policy:** Prevents information leakage through URLs

### Testing Strategy

We wrote comprehensive unit tests that verify:
1. All headers are set correctly with defaults
2. Custom configuration works as expected
3. Middleware integrates properly with the request chain
4. No side effects on request/response objects

This gives us confidence that the middleware works correctly and will continue to work as the codebase evolves.
