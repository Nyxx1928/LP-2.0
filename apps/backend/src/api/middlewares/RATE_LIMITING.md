# Rate Limiting Middleware - Usage Guide

## Overview

This guide explains how to use the rate limiting middleware to protect your authentication endpoints from brute force attacks and abuse.

## Quick Start

### 1. Import the Middleware

```typescript
import {
  loginRateLimit,
  registrationRateLimit,
  passwordResetRateLimit,
} from '../middlewares/rate-limit';
```

### 2. Apply to Routes

```typescript
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { loginRateLimit } from '../middlewares/rate-limit';

// Example: Login endpoint with rate limiting
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Apply rate limiting middleware
  await new Promise((resolve, reject) => {
    loginRateLimit(req, res, (err?: any) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  });

  // Your login logic here
  const { email, password } = req.body;
  // ... authenticate user ...
  
  return res.json({ success: true });
}
```

## Pre-configured Middleware

We provide three pre-configured middleware for common authentication endpoints:

### Login Rate Limiting

**Limit:** 5 requests per 15 minutes per IP address

**Use for:** Login endpoints

**Why per IP?**
- Prevents brute force attacks on user accounts
- Protects against credential stuffing
- Works for anonymous users (before authentication)

```typescript
import { loginRateLimit } from '../middlewares/rate-limit';

// Apply to login route
router.post('/auth/customer/emailpass', loginRateLimit, loginHandler);
```

### Registration Rate Limiting

**Limit:** 3 requests per hour per IP address

**Use for:** Registration/signup endpoints

**Why stricter?**
- Prevents mass account creation (spam, fraud)
- Registration is less frequent than login
- Reduces abuse without impacting legitimate users

```typescript
import { registrationRateLimit } from '../middlewares/rate-limit';

// Apply to registration route
router.post('/auth/customer/emailpass/register', registrationRateLimit, registerHandler);
```

### Password Reset Rate Limiting

**Limit:** 3 requests per hour per email address

**Use for:** Password reset request endpoints

**Why per email?**
- Prevents spamming a specific user with reset emails
- Per-IP would allow attackers to spam from different IPs
- Protects the target email address

```typescript
import { passwordResetRateLimit } from '../middlewares/rate-limit';

// Apply to password reset route
router.post('/auth/customer/emailpass/reset', passwordResetRateLimit, resetHandler);
```

## Custom Rate Limiters

If you need different limits, create a custom rate limiter:

```typescript
import { RateLimiter } from '../../lib/rate-limiter';
import { createRateLimitMiddleware } from '../middlewares/rate-limit';

// Create custom rate limiter: 10 requests per 5 minutes
const customLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  maxRequests: 10,           // 10 requests
  keyPrefix: 'custom',       // Redis key prefix
});

// Create middleware
const customRateLimit = createRateLimitMiddleware(customLimiter);

// Use in route
router.post('/api/custom-endpoint', customRateLimit, handler);
```

## Rate Limiting by Different Identifiers

### By IP Address (Default)

```typescript
import { createRateLimitMiddleware } from '../middlewares/rate-limit';

const ipRateLimit = createRateLimitMiddleware(myLimiter);
// Uses IP address automatically
```

### By Email Address

```typescript
import { createRateLimitMiddleware, getEmailIdentifier } from '../middlewares/rate-limit';

const emailRateLimit = createRateLimitMiddleware(
  myLimiter,
  getEmailIdentifier  // Extract email from req.body.email
);
```

### By User ID (Authenticated)

```typescript
import { createRateLimitMiddleware } from '../middlewares/rate-limit';

const userRateLimit = createRateLimitMiddleware(
  myLimiter,
  (req) => req.user?.id || req.ip  // Use user ID if authenticated, else IP
);
```

### Custom Identifier

```typescript
import { createRateLimitMiddleware } from '../middlewares/rate-limit';

const customRateLimit = createRateLimitMiddleware(
  myLimiter,
  (req) => {
    // Custom logic: combine IP and user agent
    return `${req.ip}:${req.headers['user-agent']}`;
  }
);
```

## Error Responses

When rate limit is exceeded, the middleware returns:

```json
{
  "error": {
    "type": "rate_limit_exceeded",
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again in 847 seconds.",
    "retryAfter": 847
  }
}
```

**HTTP Status:** 429 Too Many Requests

**Headers:**
- `Retry-After: 847` (seconds until retry is allowed)

## Frontend Integration

### Handling Rate Limit Errors

```typescript
async function login(email: string, password: string) {
  try {
    const response = await fetch('/auth/customer/emailpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.status === 429) {
      // Rate limit exceeded
      const data = await response.json();
      const retryAfter = data.error.retryAfter;
      
      // Show user-friendly message
      alert(`Too many login attempts. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`);
      
      // Optionally disable submit button
      disableSubmitButton(retryAfter);
      
      return;
    }

    // Handle success
    const data = await response.json();
    // ...
  } catch (error) {
    console.error('Login error:', error);
  }
}
```

### Reading Retry-After Header

```typescript
const retryAfter = response.headers.get('Retry-After');
if (retryAfter) {
  const seconds = parseInt(retryAfter, 10);
  console.log(`Retry after ${seconds} seconds`);
}
```

## Testing

### Manual Testing with curl

```bash
# Test login rate limit (5 requests per 15 minutes)
for i in {1..6}; do
  curl -X POST http://localhost:9000/auth/customer/emailpass \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n\n"
  sleep 1
done

# 6th request should return 429
```

### Resetting Rate Limits (Development)

```typescript
import { loginRateLimiter } from '../../lib/rate-limiter';

// Reset rate limit for specific IP
await loginRateLimiter.resetCounter('192.168.1.1');

// Reset rate limit for specific email
await passwordResetRateLimiter.resetCounter('user@example.com');
```

## Monitoring

### Logging Rate Limit Events

The middleware automatically logs errors, but you can add custom logging:

```typescript
import { createRateLimitMiddleware } from '../middlewares/rate-limit';

const loggingRateLimit = createRateLimitMiddleware(myLimiter);

// Wrap middleware to add logging
const rateLimitWithLogging = async (req, res, next) => {
  const identifier = req.ip;
  
  await loggingRateLimit(req, res, (err) => {
    if (res.statusCode === 429) {
      console.log(`Rate limit exceeded for ${identifier}`);
      // Send to monitoring system
    }
    next(err);
  });
};
```

### Metrics to Track

1. **Rate limit hits:** How often users hit the limit
2. **Blocked requests:** Total requests blocked
3. **Top offenders:** IPs/emails hitting limit most often
4. **False positives:** Legitimate users being blocked

## Security Considerations

### 1. Distributed Attacks

Rate limiting by IP protects against single-source attacks but not distributed attacks (botnets). Consider:

- Additional layers: CAPTCHA after N failed attempts
- Behavioral analysis: Detect suspicious patterns
- Account lockout: Lock account after repeated failures

### 2. Shared IPs

Users behind NAT or VPN share IP addresses. This can cause:

- Legitimate users being blocked by others' actions
- Lower effective rate limit per user

Solutions:
- Use email-based rate limiting when possible
- Increase limits for known shared IPs
- Implement user-based rate limiting after authentication

### 3. IP Spoofing

`X-Forwarded-For` header can be spoofed if you don't control the proxy. Ensure:

- Only trust X-Forwarded-For from your load balancer
- Configure your proxy to strip client-provided headers
- Use `X-Real-IP` from trusted sources only

### 4. Redis Availability

If Redis goes down, the middleware fails open (allows requests). This is intentional to maintain availability, but means:

- No rate limiting during Redis outage
- Monitor Redis health closely
- Consider fail-closed for high-security endpoints

## Troubleshooting

### Rate Limits Not Working

1. **Check Redis connection:**
   ```typescript
   import { redisManager } from '../../lib/redis';
   const isHealthy = await redisManager.healthCheck();
   console.log('Redis healthy:', isHealthy);
   ```

2. **Verify middleware is applied:**
   - Check route configuration
   - Ensure middleware is before handler
   - Check for middleware errors in logs

3. **Check identifier extraction:**
   ```typescript
   // Add logging to see what identifier is used
   console.log('Rate limit identifier:', req.ip);
   ```

### Users Blocked Incorrectly

1. **Check if shared IP:**
   - Multiple users behind same NAT/VPN
   - Consider per-email rate limiting

2. **Check time window:**
   - Sliding window includes previous window
   - User might have hit limit earlier

3. **Check for clock skew:**
   - Ensure server time is correct
   - Redis and app server should have synchronized clocks

### Performance Issues

1. **Redis latency:**
   - Check Redis response times
   - Ensure Redis is on same network
   - Consider Redis cluster for high traffic

2. **Too many Redis calls:**
   - Each request makes 2-3 Redis calls
   - This is normal and very fast (< 1ms)
   - Redis can handle 100k+ ops/sec

## Best Practices

1. **Start conservative:** Begin with stricter limits, relax if needed
2. **Monitor metrics:** Track rate limit hits and adjust
3. **Communicate clearly:** Show users why they're blocked and when they can retry
4. **Layer defenses:** Rate limiting + account lockout + CAPTCHA
5. **Test thoroughly:** Verify limits work as expected
6. **Document limits:** Make it clear to API consumers
7. **Provide escape hatch:** Allow admins to reset limits
8. **Consider user experience:** Don't make limits too strict for legitimate users

## Advanced Topics

### Distributed Rate Limiting

The rate limiter uses Redis, so it automatically works across multiple backend instances:

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Backend │────▶│  Redis  │◀────│ Backend │
│ Server 1│     │ (Shared)│     │ Server 2│
└─────────┘     └─────────┘     └─────────┘
```

All servers share the same rate limit counters in Redis.

### Sliding Window Algorithm

Our implementation uses a sliding window for accurate rate limiting:

```
Fixed Window (BAD):
[────────────────] [────────────────]
0:00          0:15 0:15          0:30
     5 req at 0:14 + 5 req at 0:16 = 10 req in 2 min! ❌

Sliding Window (GOOD):
[────────────────]
      [────────────────]
           [────────────────]
0:00    0:05    0:10    0:15    0:20
Checks last 15 minutes from current time ✓
```

### Token Bucket Alternative

Our sliding window is simpler than token bucket but equally effective:

**Sliding Window:**
- Pros: Simple, accurate, easy to understand
- Cons: Requires storing counts per time bucket

**Token Bucket:**
- Pros: Allows bursts, more flexible
- Cons: More complex, harder to reason about

For authentication endpoints, sliding window is preferred because:
- We want to prevent bursts (not allow them)
- Simplicity reduces bugs
- Easier to explain to users

## Summary

Rate limiting is a critical security feature that:

✅ Prevents brute force attacks
✅ Protects against denial of service
✅ Reduces resource exhaustion
✅ Controls costs (email sending, etc.)

Our implementation:

✅ Uses Redis for distributed rate limiting
✅ Implements sliding window algorithm
✅ Provides pre-configured middleware
✅ Fails open for availability
✅ Returns standard HTTP 429 responses
✅ Includes Retry-After headers

Apply it to all authentication endpoints for robust security!
