# CSRF Protection Implementation Summary

## What is CSRF?

**CSRF (Cross-Site Request Forgery)** is an attack where a malicious website tricks your browser into making unwanted requests to a site you're logged into.

### Attack Example:
1. You log into `yourbank.com` (you have a valid session cookie)
2. You visit `evil.com` (in another tab)
3. `evil.com` has hidden code: `<form action="yourbank.com/transfer" method="POST">`
4. Your browser automatically sends your `yourbank.com` cookies with the request!
5. The bank thinks it's you and transfers money to the attacker

### The Problem:
- Browsers automatically include cookies in requests
- The bank can't tell if YOU clicked the button or `evil.com` did
- Session cookies alone aren't enough to verify intent

## How Our CSRF Protection Works

We use the **Double-Submit Cookie Pattern** with **SameSite=Strict** cookies:

### 1. Token Generation
```typescript
const token = await csrfProtection.generateToken();
```

- Generates a cryptographically secure random token (32 bytes = 256 bits)
- Stores token in Redis with 1-hour expiration
- Returns token to be sent in both cookie and response body

### 2. Token Distribution
The server sends the token in TWO places:
- **Cookie**: Browser stores it automatically
- **Response Body**: Frontend stores it in memory/localStorage

### 3. Token Submission
The frontend includes the token in TWO places when making requests:
- **Cookie**: Browser sends automatically
- **Custom Header** (`X-CSRF-Token`): Frontend must explicitly add

### 4. Token Validation
```typescript
const isValid = await csrfProtection.validateToken(cookieToken, headerToken);
```

Server validates: `Cookie token === Header token`

### Why This Works:
- `evil.com` can trigger requests that include cookies (automatic)
- BUT `evil.com` CANNOT read your cookies (Same-Origin Policy)
- So `evil.com` cannot get the token to put in the header
- Only YOUR frontend (same origin) can read the cookie and add the header

## Security Features

### 1. SameSite=Strict Cookies
- Browser NEVER sends cookie in cross-site requests
- Even if `evil.com` tries to make a request, the cookie won't be included
- This blocks CSRF attacks at the browser level

### 2. Constant-Time Comparison
We use `crypto.timingSafeEqual()` to prevent timing attacks:

**Normal Comparison (VULNERABLE):**
```typescript
if (token1 === token2) // Stops at first different character
```
- `"aaaa"` vs `"baaa"` fails fast (1 comparison)
- `"aaaa"` vs `"aaab"` fails slow (4 comparisons)
- Attacker measures response time to guess token character by character!

**Constant-Time Comparison (SECURE):**
```typescript
timingSafeEqual(buffer1, buffer2) // Always compares ALL characters
```
- `"aaaa"` vs `"baaa"` takes same time as `"aaaa"` vs `"aaab"`
- Attacker cannot learn anything from timing
- Prevents token guessing attacks

### 3. Cryptographically Secure Tokens
- Uses `crypto.randomBytes()` for token generation
- 32 bytes = 256 bits of entropy
- 2^256 possible tokens (more than atoms in the universe!)
- Impossible to guess even with billions of attempts

### 4. Automatic Expiration
- Tokens expire after 1 hour
- Limits attack window
- Redis TTL automatically cleans up expired tokens

### 5. Redis Storage
We use Redis instead of database because:
- **Speed**: < 1ms (in-memory) vs 10-50ms (disk I/O)
- **Automatic Expiration**: Built-in TTL, no cleanup jobs needed
- **Distributed**: Works across multiple backend servers
- **Ephemeral**: Tokens are temporary, don't need durability

## API Reference

### CSRFProtection Class

```typescript
import { CSRFProtection, csrfProtection } from './csrf-protection';

// Use singleton instance
const token = await csrfProtection.generateToken();
const isValid = await csrfProtection.validateToken(cookieToken, headerToken);

// Or create custom instance
const csrf = new CSRFProtection({
  tokenLength: 32,
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  tokenExpiration: 3600, // 1 hour
});
```

### Methods

#### `generateToken(): Promise<string>`
Generates a new CSRF token and stores it in Redis.

**Returns:** Base64url-encoded token (43 characters)

**Example:**
```typescript
const token = await csrfProtection.generateToken();
// Returns: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v"
```

#### `validateToken(cookieToken, headerToken): Promise<boolean>`
Validates a CSRF token using constant-time comparison.

**Parameters:**
- `cookieToken`: Token from cookie (browser sends automatically)
- `headerToken`: Token from header (frontend must add explicitly)

**Returns:** `true` if valid, `false` otherwise

**Example:**
```typescript
const isValid = await csrfProtection.validateToken(
  req.cookies['csrf-token'],
  req.headers['x-csrf-token']
);

if (!isValid) {
  return res.status(403).json({ error: 'Invalid CSRF token' });
}
```

#### `invalidateToken(token): Promise<void>`
Invalidates a CSRF token (deletes from Redis).

**Use cases:**
- Single-use tokens
- User logout
- Security incident

**Example:**
```typescript
await csrfProtection.invalidateToken(token);
```

#### `tokenExists(token): Promise<boolean>`
Checks if a token exists in Redis (without validation).

**Use cases:**
- Debugging
- Monitoring
- Testing

**Example:**
```typescript
const exists = await csrfProtection.tokenExists(token);
console.log(`Token exists: ${exists}`);
```

## Usage in Middleware

### Backend (Medusa)

```typescript
import { csrfProtection } from '../lib/csrf-protection';

// Generate token endpoint
app.get('/auth/csrf-token', async (req, res) => {
  const token = await csrfProtection.generateToken();
  
  // Set token in cookie with SameSite=Strict
  res.cookie('csrf-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000, // 1 hour
  });
  
  // Also return token in response body
  res.json({ token });
});

// Validation middleware
const validateCSRF = async (req, res, next) => {
  // Skip validation for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];
  
  const isValid = await csrfProtection.validateToken(cookieToken, headerToken);
  
  if (!isValid) {
    return res.status(403).json({
      error: {
        type: 'csrf_error',
        message: 'Invalid or missing CSRF token',
      },
    });
  }
  
  next();
};

// Apply to authentication endpoints
app.post('/auth/customer/emailpass', validateCSRF, loginHandler);
app.post('/auth/customer/emailpass/register', validateCSRF, registerHandler);
```

### Frontend (Next.js)

```typescript
// Fetch CSRF token before form submission
async function fetchCSRFToken() {
  const response = await fetch('/auth/csrf-token', {
    credentials: 'include', // Include cookies
  });
  const { token } = await response.json();
  return token;
}

// Include token in request
async function login(email, password) {
  const csrfToken = await fetchCSRFToken();
  
  const response = await fetch('/auth/customer/emailpass', {
    method: 'POST',
    credentials: 'include', // Include cookies
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken, // Add token to header
    },
    body: JSON.stringify({ email, password }),
  });
  
  return response.json();
}
```

## Testing

We have comprehensive tests covering:

### Token Generation (5 tests)
- ✅ Generates tokens successfully
- ✅ Tokens are unique (100 tokens, no duplicates)
- ✅ Tokens have correct format (base64url, 43 characters)
- ✅ Tokens are stored in Redis
- ✅ Tokens have expiration set (1 hour)

### Token Validation (7 tests)
- ✅ Valid tokens pass validation
- ✅ Mismatched tokens fail
- ✅ Missing cookie token fails
- ✅ Missing header token fails
- ✅ Empty tokens fail
- ✅ Non-existent tokens fail
- ✅ Different length tokens fail

### Token Expiration (2 tests)
- ✅ Expired tokens fail validation
- ✅ Expired tokens are removed from Redis

### Token Invalidation (2 tests)
- ✅ Invalidated tokens fail validation
- ✅ Invalidated tokens are removed from Redis

### Security Properties (2 tests)
- ✅ Uses constant-time comparison
- ✅ Tokens have high entropy

### Error Handling (1 test)
- ✅ Fails securely on Redis errors

**Total: 19 tests, all passing ✅**

## Requirements Validation

This implementation satisfies the following requirements:

### Requirement 8.1: Token Generation
✅ Generates CSRF tokens when customer loads authentication form

### Requirement 8.2: Cookie with SameSite=Strict
✅ Includes token in cookie with SameSite=Strict attribute

### Requirement 8.3: Token in Request
✅ Frontend includes token in request header

### Requirement 8.4: Token Validation
✅ Validates CSRF token on authentication requests

### Requirement 8.5: Reject Invalid Tokens
✅ Rejects requests with missing or invalid tokens (HTTP 403)

### Requirement 8.6: Token Expiration
✅ Tokens expire after 1 hour

### Requirement 8.7: Apply to Endpoints
✅ Ready to apply to login, registration, password reset, and account update endpoints

## Performance Characteristics

- **Token Generation**: ~1-2ms (Redis write + crypto.randomBytes)
- **Token Validation**: ~1-2ms (Redis read + constant-time comparison)
- **Memory Usage**: ~100 bytes per token in Redis
- **Throughput**: Thousands of validations per second

## Security Considerations

### Defense in Depth
1. **SameSite=Strict**: Browser-level protection
2. **CSRF Token**: Server-level validation
3. **Constant-Time Comparison**: Prevents timing attacks
4. **Cryptographic Randomness**: Prevents token guessing
5. **Automatic Expiration**: Limits attack window

### Fail Securely
- If Redis is down, validation fails (denies request)
- Better to block legitimate users than allow attacks
- Users can retry when Redis is back

### No Information Leakage
- Generic error messages (don't reveal why validation failed)
- Constant-time comparison (don't reveal token differences)
- Logs warnings for debugging (not exposed to users)

## Future Enhancements

1. **Single-Use Tokens**: Invalidate token after successful use
2. **Origin Validation**: Check Origin/Referer headers as additional protection
3. **Token Rotation**: Rotate tokens on each form load
4. **Rate Limiting**: Limit token generation per IP/user
5. **Monitoring**: Track CSRF validation failures for security alerts

## Conclusion

Our CSRF protection implementation provides robust defense against cross-site request forgery attacks using industry best practices:

- ✅ Double-submit cookie pattern
- ✅ SameSite=Strict cookies
- ✅ Constant-time comparison
- ✅ Cryptographically secure tokens
- ✅ Automatic expiration
- ✅ Distributed (Redis-based)
- ✅ Comprehensive test coverage

The implementation is production-ready and follows the security requirements specified in the design document.
