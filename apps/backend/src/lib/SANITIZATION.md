# Input Sanitization Guide

This document explains how to properly sanitize user input to prevent security vulnerabilities.

## Why Sanitize Input?

User input is the #1 source of security vulnerabilities:
- **XSS (Cross-Site Scripting)**: Malicious scripts injected into web pages
- **SQL Injection**: Malicious SQL queries that access/modify database
- **Prototype Pollution**: Manipulating JavaScript object prototypes
- **DoS (Denial of Service)**: Overwhelming the system with large inputs

## Available Sanitization Functions

### String Sanitization

```typescript
import { sanitizeString } from './sanitization';

// Removes HTML tags, escapes quotes, limits length
const clean = sanitizeString(userInput);
```

**Use for**: Names, descriptions, comments, any free-text input

### Email Sanitization

```typescript
import { sanitizeEmail } from './sanitization';

// Validates format, normalizes to lowercase
const email = sanitizeEmail(userInput); // throws if invalid
```

**Use for**: Email addresses, login identifiers

### Username Sanitization

```typescript
import { sanitizeUsername } from './sanitization';

// Allows only alphanumeric, underscore, hyphen
const username = sanitizeUsername(userInput); // throws if invalid
```

**Use for**: Usernames, slugs, identifiers

### Phone Number Sanitization

```typescript
import { sanitizePhoneNumber } from './sanitization';

// Removes all non-numeric characters
const phone = sanitizePhoneNumber(userInput); // throws if invalid
```

**Use for**: Phone numbers

### URL Sanitization

```typescript
import { sanitizeUrl } from './sanitization';

// Validates URL format, allows only HTTP/HTTPS
const url = sanitizeUrl(userInput); // throws if invalid
```

**Use for**: Website URLs, redirect URLs, image URLs

### Number Sanitization

```typescript
import { sanitizeNumber } from './sanitization';

// Validates and constrains numeric input
const age = sanitizeNumber(userInput, { min: 0, max: 120, integer: true });
const price = sanitizeNumber(userInput, { min: 0 });
```

**Use for**: Ages, prices, quantities, ratings

### Object Sanitization

```typescript
import { sanitizeObject } from './sanitization';

// Removes dangerous keys, filters by whitelist
const clean = sanitizeObject(req.body, ['name', 'email', 'age']);
```

**Use for**: Request bodies, user profiles, settings

### HTML Sanitization

```typescript
import { sanitizeHtml } from './sanitization';

// Removes scripts, event handlers, dangerous tags
const clean = sanitizeHtml(userInput);
```

**Use for**: Rich text content, blog posts, comments
**Note**: For production, use a library like DOMPurify

### JSON Sanitization

```typescript
import { sanitizeJson } from './sanitization';

// Parses JSON and removes dangerous properties
const data = sanitizeJson(jsonString);
```

**Use for**: API payloads, configuration data

## Rate Limiting

```typescript
import { RateLimiter } from './sanitization';

const limiter = new RateLimiter(100, 60000); // 100 requests per minute

if (!limiter.check(userId)) {
  throw new Error('Rate limit exceeded');
}
```

**Use for**: Login attempts, API endpoints, password resets

## Best Practices

### 1. Sanitize at the Entry Point

```typescript
// ✅ Good: Sanitize immediately when receiving input
export async function createUser(req: MedusaRequest, res: MedusaResponse) {
  const email = sanitizeEmail(req.body.email);
  const name = sanitizeString(req.body.name);
  // ... rest of logic
}

// ❌ Bad: Using raw input
export async function createUser(req: MedusaRequest, res: MedusaResponse) {
  const email = req.body.email; // Unsanitized!
  // ... rest of logic
}
```

### 2. Use Whitelisting, Not Blacklisting

```typescript
// ✅ Good: Only allow specific fields
const updates = sanitizeObject(req.body, ['name', 'email', 'phone']);

// ❌ Bad: Try to block dangerous fields (easy to bypass)
delete req.body.__proto__;
delete req.body.constructor;
```

### 3. Validate Before Sanitizing

```typescript
// ✅ Good: Check type first
if (typeof req.body.email !== 'string') {
  throw new Error('Email must be a string');
}
const email = sanitizeEmail(req.body.email);

// ❌ Bad: Sanitize without validation
const email = sanitizeEmail(req.body.email); // Might fail unexpectedly
```

### 4. Never Sanitize Passwords

```typescript
// ✅ Good: Validate length/complexity, but don't modify
if (typeof password !== 'string' || password.length < 8) {
  throw new Error('Password must be at least 8 characters');
}
const hashedPassword = await hash(password);

// ❌ Bad: Sanitizing passwords changes them
const password = sanitizeString(req.body.password); // DON'T DO THIS
```

### 5. Use Parameterized Queries

```typescript
// ✅ Good: Use parameterized queries (prevents SQL injection)
const users = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

// ❌ Bad: String concatenation (SQL injection risk)
const users = await db.query(
  `SELECT * FROM users WHERE email = '${email}'`
);
```

### 6. Sanitize Output Too

```typescript
// ✅ Good: Sanitize when displaying user content
<div>{sanitizeHtml(userComment)}</div>

// ❌ Bad: Displaying raw user content
<div dangerouslySetInnerHTML={{ __html: userComment }} />
```

## Middleware Usage

Apply sanitization globally using middleware:

```typescript
import { sanitizeRequestBody, sanitizeQueryParams } from '../middlewares/sanitize';

// Apply to all routes
app.use(sanitizeRequestBody);
app.use(sanitizeQueryParams);

// Or apply to specific routes
app.post('/api/users', sanitizeRequestBody, createUser);
```

## Testing

Always test your sanitization:

```typescript
import { sanitizeEmail } from './sanitization';

describe('Email Sanitization', () => {
  it('should reject invalid emails', () => {
    expect(() => sanitizeEmail('not-an-email')).toThrow();
  });

  it('should normalize valid emails', () => {
    expect(sanitizeEmail('Test@Example.COM')).toBe('test@example.com');
  });
});
```

## CI/CD Integration

The CI pipeline checks for unsafe input handling patterns:
- Direct SQL concatenation
- `eval()` usage
- `innerHTML` without sanitization
- `dangerouslySetInnerHTML` without sanitization

See `.github/workflows/ci.yml` for details.

## Additional Resources

- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
