# Design Document: Robust Authentication System

## Overview

This design document specifies the technical architecture for enhancing the Likhang Pinas e-commerce authentication system. The current implementation uses Medusa v2's built-in email/password authentication but lacks critical security features and user management capabilities required for production deployment.

The enhanced system will implement:
- **Security hardening**: Rate limiting, account lockout, CSRF protection, strong secret enforcement, security headers
- **Core authentication flows**: Logout, password reset, email verification
- **User management**: Account settings, session management, password changes
- **Enhanced UX**: Password strength validation, visibility toggles, improved error handling
- **Operational capabilities**: Audit logging, email service integration

### Technology Stack

- **Backend**: Medusa v2 (Node.js/TypeScript)
- **Frontend**: Next.js 15 (React/TypeScript)
- **Database**: PostgreSQL (via Medusa)
- **Cache/Rate Limiting**: Redis
- **Email**: Resend (transactional email service)
- **Testing**: Jest (unit tests), fast-check (property-based tests)

### Design Principles

1. **Security by default**: All authentication endpoints protected with rate limiting, CSRF tokens, and secure session management
2. **Defense in depth**: Multiple layers of security (rate limiting, account lockout, strong passwords, audit logging)
3. **Fail securely**: Generic error messages to prevent information disclosure, secure defaults for missing configuration
4. **Separation of concerns**: Clear boundaries between authentication logic, session management, email services, and UI components
5. **Testability**: Pure functions for validation logic, dependency injection for external services

## Architecture

### System Components

```mermaid
graph TB
    subgraph Frontend["Storefront (Next.js)"]
        AuthUI[Auth Pages]
        AccountUI[Account Management UI]
        AuthClient[Auth API Client]
    end
    
    subgraph Backend["Medusa Backend"]
        AuthRoutes[Auth Routes]
        AuthMiddleware[Auth Middleware]
        RateLimiter[Rate Limiter]
        CSRFProtection[CSRF Protection]
        SessionManager[Session Manager]
        PasswordValidator[Password Validator]
        TokenService[Token Service]
        AuditLogger[Audit Logger]
    end
    
    subgraph External["External Services"]
        Redis[(Redis)]
        PostgreSQL[(PostgreSQL)]
        EmailService[Email Service]
    end
    
    AuthUI --> AuthClient
    AccountUI --> AuthClient
    AuthClient --> AuthRoutes
    AuthRoutes --> AuthMiddleware
    AuthMiddleware --> RateLimiter
    AuthMiddleware --> CSRFProtection
    AuthRoutes --> SessionManager
    AuthRoutes --> PasswordValidator
    AuthRoutes --> TokenService
    AuthRoutes --> AuditLogger
    RateLimiter --> Redis
    SessionManager --> PostgreSQL
    TokenService --> PostgreSQL
    AuditLogger --> PostgreSQL
    TokenService --> EmailService
```

### Request Flow

#### Login Flow
1. Client requests CSRF token from backend
2. Client submits login form with email, password, and CSRF token
3. Rate limiter checks request count for IP address
4. CSRF protection validates token
5. Authentication middleware validates credentials
6. Account lockout check verifies account is not locked
7. On success: Create session, set HTTP-only cookies, reset failed login count
8. On failure: Increment failed login count, lock account if threshold reached
9. Audit logger records event
10. Return response to client

#### Password Reset Flow
1. Client requests password reset for email address
2. Rate limiter checks request count for email
3. Generate password reset token (single-use, 1-hour expiration)
4. Store token in database with expiration timestamp
5. Send email with reset link
6. Audit logger records event
7. Return generic success message (prevent email enumeration)
8. Client clicks link, submits new password with token
9. Validate token (exists, not expired, not used)
10. Validate new password strength
11. Update password, invalidate token
12. Invalidate all sessions except current
13. Audit logger records event

#### Email Verification Flow
1. On registration, generate email verification token (24-hour expiration)
2. Store token in database
3. Send verification email
4. Client clicks verification link
5. Validate token (exists, not expired)
6. Mark email as verified
7. Invalidate token
8. Audit logger records event

### Data Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Middleware
    participant A as Auth Service
    participant D as Database
    participant R as Redis
    participant E as Email Service
    
    C->>M: POST /auth/customer/emailpass
    M->>R: Check rate limit
    R-->>M: OK
    M->>M: Validate CSRF token
    M->>A: Authenticate(email, password)
    A->>D: Query customer by email
    D-->>A: Customer record
    A->>A: Verify password hash
    A->>D: Check failed login count
    D-->>A: Count = 3
    A->>D: Create session
    D-->>A: Session created
    A->>D: Reset failed login count
    A->>D: Log audit event
    A-->>M: Session token
    M-->>C: Set-Cookie + 200 OK
```

## Components and Interfaces

### Backend Components

#### 1. Rate Limiter Middleware

**Purpose**: Prevent brute force attacks by limiting request rates per IP/email.

**Interface**:
```typescript
interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (req: MedusaRequest) => string;
  skipSuccessfulRequests?: boolean;
}

class RateLimiter {
  constructor(private redis: Redis, private config: RateLimiterConfig) {}
  
  async checkLimit(key: string): Promise<RateLimitResult>;
  async incrementCounter(key: string): Promise<void>;
  async resetCounter(key: string): Promise<void>;
}

type RateLimitResult = 
  | { allowed: true }
  | { allowed: false; retryAfter: number };
```

**Implementation Notes**:
- Use Redis INCR with EXPIRE for atomic counter operations
- Sliding window algorithm for accurate rate limiting
- Different limits for different endpoints (login, registration, password reset)
- Key format: `ratelimit:{endpoint}:{identifier}:{window}`

#### 2. CSRF Protection Middleware

**Purpose**: Prevent cross-site request forgery attacks on authentication endpoints.

**Interface**:
```typescript
interface CSRFConfig {
  tokenLength: number;
  cookieName: string;
  headerName: string;
  excludedMethods: string[];
}

class CSRFProtection {
  constructor(private config: CSRFConfig) {}
  
  generateToken(): string;
  validateToken(cookieToken: string, headerToken: string): boolean;
  middleware(): MedusaMiddleware;
}
```

**Implementation Notes**:
- Generate cryptographically secure random tokens (32 bytes)
- Store token in HTTP-only cookie with SameSite=Strict
- Require token in custom header (X-CSRF-Token) for state-changing requests
- Tokens expire after 1 hour
- Double-submit cookie pattern

#### 3. Session Manager

**Purpose**: Manage authenticated sessions with secure token generation and validation.

**Interface**:
```typescript
interface SessionConfig {
  jwtSecret: string;
  cookieSecret: string;
  sessionTimeout: number;
  rememberMeDuration: number;
}

interface SessionData {
  customerId: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  rememberMe: boolean;
  deviceInfo?: DeviceInfo;
}

class SessionManager {
  constructor(
    private config: SessionConfig,
    private db: Database
  ) {}
  
  async createSession(
    customerId: string,
    rememberMe: boolean,
    deviceInfo?: DeviceInfo
  ): Promise<string>;
  
  async validateSession(token: string): Promise<SessionData | null>;
  async extendSession(token: string): Promise<void>;
  async invalidateSession(token: string): Promise<void>;
  async invalidateAllSessions(customerId: string, exceptToken?: string): Promise<void>;
  async listActiveSessions(customerId: string): Promise<SessionData[]>;
}
```

**Implementation Notes**:
- Use JWT for stateless session tokens
- Store session metadata in database for revocation capability
- HTTP-only cookies with Secure and SameSite=Strict flags
- Automatic session extension on activity (sliding expiration)
- Support for "Remember Me" with extended duration

#### 4. Password Validator

**Purpose**: Enforce strong password requirements and validate password strength.

**Interface**:
```typescript
interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  forbiddenPatterns: RegExp[];
}

interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
}

class PasswordValidator {
  constructor(
    private requirements: PasswordRequirements,
    private commonPasswords: Set<string>
  ) {}
  
  validate(password: string, email?: string): PasswordValidationResult;
  calculateStrength(password: string): number;
}
```

**Implementation Notes**:
- Minimum 12 characters
- Must contain uppercase, lowercase, number, special character
- Check against common password list (top 10,000)
- Reject passwords containing email address
- Strength calculation based on entropy and character diversity
- Pure function for easy testing

#### 5. Token Service

**Purpose**: Generate and validate time-limited, single-use tokens for password reset and email verification.

**Interface**:
```typescript
interface TokenConfig {
  passwordResetExpiration: number; // 1 hour
  emailVerificationExpiration: number; // 24 hours
  tokenLength: number; // 32 bytes
}

interface Token {
  id: string;
  type: 'password_reset' | 'email_verification';
  customerId: string;
  email: string;
  token: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

class TokenService {
  constructor(
    private config: TokenConfig,
    private db: Database,
    private emailService: EmailService
  ) {}
  
  async generatePasswordResetToken(email: string): Promise<void>;
  async validatePasswordResetToken(token: string): Promise<Token | null>;
  async consumePasswordResetToken(token: string): Promise<void>;
  
  async generateEmailVerificationToken(customerId: string, email: string): Promise<void>;
  async validateEmailVerificationToken(token: string): Promise<Token | null>;
  async consumeEmailVerificationToken(token: string): Promise<void>;
  
  async cleanupExpiredTokens(): Promise<number>;
}
```

**Implementation Notes**:
- Cryptographically secure random token generation
- Store hashed tokens in database (bcrypt)
- Single-use tokens (mark as used after consumption)
- Automatic cleanup of expired tokens (background job)
- Rate limiting on token generation (3 per hour per email)

#### 6. Audit Logger

**Purpose**: Record authentication events for security monitoring and incident investigation.

**Interface**:
```typescript
interface AuditEvent {
  id: string;
  eventType: 
    | 'login_success'
    | 'login_failure'
    | 'logout'
    | 'password_change'
    | 'password_reset_request'
    | 'password_reset_complete'
    | 'email_verification'
    | 'account_locked'
    | 'account_unlocked';
  customerId?: string;
  email?: string;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

class AuditLogger {
  constructor(private db: Database) {}
  
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void>;
  async query(filters: AuditEventFilters): Promise<AuditEvent[]>;
  async cleanup(retentionDays: number): Promise<number>;
}
```

**Implementation Notes**:
- Structured logging with consistent event types
- Store in dedicated audit_events table
- Include IP address and user agent for forensics
- 90-day retention policy
- Indexed by customerId, email, eventType, timestamp

#### 7. Email Service

**Purpose**: Send transactional emails reliably with retry logic and template support.

**Interface**:
```typescript
interface EmailConfig {
  provider: 'resend';
  apiKey: string;
  fromAddress: string;
  fromName: string;
  maxRetries: number;
  retryDelay: number;
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

class EmailService {
  constructor(private config: EmailConfig) {}
  
  async sendPasswordReset(
    to: string,
    name: string,
    resetToken: string
  ): Promise<void>;
  
  async sendEmailVerification(
    to: string,
    name: string,
    verificationToken: string
  ): Promise<void>;
  
  async sendAccountLocked(
    to: string,
    name: string,
    unlockTime: Date
  ): Promise<void>;
  
  private async send(
    to: string,
    template: EmailTemplate,
    variables: Record<string, string>
  ): Promise<void>;
}
```

**Implementation Notes**:
- Use Resend API for email delivery
- Exponential backoff retry (3 attempts: 1s, 2s, 4s)
- HTML and plain text versions of all emails
- Template variables for personalization
- Email validation before sending
- Log delivery failures for monitoring

### Frontend Components

#### 1. Auth Pages

**Components**:
- `LoginForm`: Email/password login with CSRF protection
- `RegisterForm`: Account creation with password strength indicator
- `ForgotPasswordForm`: Request password reset email
- `ResetPasswordForm`: Set new password with token
- `EmailVerificationBanner`: Reminder for unverified accounts

**Shared Features**:
- Password visibility toggle
- Real-time validation feedback
- Field-level and form-level error display
- Loading states during submission
- CSRF token management

#### 2. Account Management UI

**Components**:
- `AccountProfile`: Display and edit profile information
- `ChangePasswordForm`: Update password with current password verification
- `SessionList`: Display active sessions with device info
- `SessionRevokeButton`: Revoke individual or all sessions

**Features**:
- Inline editing with validation
- Confirmation dialogs for destructive actions
- Success/error toast notifications
- Optimistic UI updates

#### 3. Auth API Client

**Interface**:
```typescript
class AuthClient {
  constructor(private baseUrl: string) {}
  
  async login(email: string, password: string, rememberMe: boolean): Promise<void>;
  async register(data: RegisterData): Promise<void>;
  async logout(): Promise<void>;
  
  async requestPasswordReset(email: string): Promise<void>;
  async resetPassword(token: string, newPassword: string): Promise<void>;
  
  async verifyEmail(token: string): Promise<void>;
  async resendVerificationEmail(): Promise<void>;
  
  async getProfile(): Promise<CustomerProfile>;
  async updateProfile(data: Partial<CustomerProfile>): Promise<void>;
  async changePassword(currentPassword: string, newPassword: string): Promise<void>;
  
  async listSessions(): Promise<Session[]>;
  async revokeSession(sessionId: string): Promise<void>;
  async revokeAllSessions(): Promise<void>;
  
  private async fetchWithCSRF(path: string, options: RequestInit): Promise<Response>;
}
```

**Implementation Notes**:
- Automatic CSRF token handling
- Credential inclusion for cookies
- Error parsing and normalization
- TypeScript types for all requests/responses

## Data Models

### Database Schema

#### customers table (existing, extended)
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL;
```

#### sessions table (new)
```sql
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  remember_me BOOLEAN DEFAULT FALSE,
  device_info JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_activity_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_customer_id (customer_id),
  INDEX idx_expires_at (expires_at)
);
```

#### tokens table (new)
```sql
CREATE TABLE auth_tokens (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'password_reset' | 'email_verification'
  customer_id VARCHAR(255) REFERENCES customers(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_token_hash (token_hash),
  INDEX idx_email_type (email, type),
  INDEX idx_expires_at (expires_at)
);
```

#### audit_events table (new)
```sql
CREATE TABLE audit_events (
  id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  customer_id VARCHAR(255) REFERENCES customers(id) ON DELETE SET NULL,
  email VARCHAR(255),
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_customer_id (customer_id),
  INDEX idx_email (email),
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at)
);
```

### Redis Data Structures

#### Rate Limiting
```
Key: ratelimit:login:{ip_address}:{window_start}
Value: request_count (integer)
TTL: 900 seconds (15 minutes)

Key: ratelimit:register:{ip_address}:{window_start}
Value: request_count (integer)
TTL: 3600 seconds (1 hour)

Key: ratelimit:password_reset:{email}:{window_start}
Value: request_count (integer)
TTL: 3600 seconds (1 hour)
```

#### CSRF Tokens
```
Key: csrf:{token_id}
Value: {customer_id, created_at}
TTL: 3600 seconds (1 hour)
```

## Error Handling

### Error Categories

1. **Validation Errors** (400 Bad Request)
   - Invalid email format
   - Password doesn't meet requirements
   - Missing required fields
   - Invalid token format

2. **Authentication Errors** (401 Unauthorized)
   - Invalid credentials
   - Session expired
   - Token expired or invalid

3. **Authorization Errors** (403 Forbidden)
   - CSRF token missing or invalid
   - Account locked
   - Email not verified (for protected actions)

4. **Rate Limit Errors** (429 Too Many Requests)
   - Too many login attempts
   - Too many registration attempts
   - Too many password reset requests

5. **Server Errors** (500 Internal Server Error)
   - Database connection failure
   - Email service failure
   - Redis connection failure

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    type: string; // Error category
    code: string; // Specific error code
    message: string; // User-friendly message
    details?: Record<string, string[]>; // Field-level errors
    retryAfter?: number; // For rate limit errors
  };
}
```

### Error Handling Strategy

1. **Generic messages for security**: Don't reveal whether email exists, account is locked, etc.
2. **Specific messages for validation**: Help users fix input errors
3. **Retry guidance**: Include Retry-After header for rate limits
4. **Logging**: Log all errors with context for debugging
5. **Graceful degradation**: Continue with reduced functionality if non-critical services fail

### Security Considerations

1. **Prevent email enumeration**: Return generic "success" message for password reset regardless of email existence
2. **Prevent timing attacks**: Use constant-time comparison for tokens and passwords
3. **Prevent account lockout DoS**: Rate limit failed login attempts by IP, not just by account
4. **Sanitize error messages**: Never expose internal implementation details or stack traces

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples, edge cases, and error conditions for individual components.

**Test Coverage**:

1. **Password Validator**
   - Valid passwords meeting all requirements
   - Invalid passwords missing each requirement
   - Common password rejection
   - Email address in password rejection
   - Strength calculation for various password types
   - Edge cases: empty string, very long passwords, unicode characters

2. **Token Service**
   - Token generation produces unique tokens
   - Token validation accepts valid tokens
   - Token validation rejects expired tokens
   - Token validation rejects used tokens
   - Token consumption marks token as used
   - Cleanup removes only expired tokens

3. **Rate Limiter**
   - Allows requests under limit
   - Blocks requests over limit
   - Returns correct retry-after time
   - Resets counter after window expires
   - Handles concurrent requests correctly

4. **CSRF Protection**
   - Generates unique tokens
   - Validates matching tokens
   - Rejects mismatched tokens
   - Rejects missing tokens
   - Handles token expiration

5. **Session Manager**
   - Creates sessions with correct expiration
   - Validates active sessions
   - Rejects expired sessions
   - Extends session on activity
   - Invalidates single session
   - Invalidates all sessions except current

6. **Email Service**
   - Sends emails with correct templates
   - Retries on failure
   - Logs failures after max retries
   - Validates email addresses before sending

7. **Audit Logger**
   - Logs events with correct structure
   - Queries events by filters
   - Cleans up old events

### Integration Tests

Integration tests will verify end-to-end flows with real database and Redis instances (using test containers).

**Test Scenarios**:

1. **Complete login flow**: Register → Login → Access protected resource
2. **Password reset flow**: Request reset → Receive email → Reset password → Login
3. **Email verification flow**: Register → Receive email → Verify → Access protected resource
4. **Account lockout flow**: 5 failed logins → Account locked → Wait → Unlock → Login
5. **Rate limiting flow**: Exceed limit → Receive 429 → Wait → Retry successfully
6. **Session management flow**: Login → List sessions → Revoke session → Access denied
7. **CSRF protection flow**: Request without token → 403 → Request with token → Success

### Property-Based Tests

Property-based tests will verify universal properties across many generated inputs for pure logic components.

**Library**: fast-check (TypeScript property-based testing library)

**Configuration**: Minimum 100 iterations per property test

**Test Properties**:

*Property-based testing is appropriate for the pure validation and token generation logic in this system. These components have clear input/output behavior and universal properties that should hold across all valid inputs.*


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified the following properties suitable for property-based testing. Several properties were combined to eliminate redundancy:

**Combined Properties**:
- Token generation properties (2.1, 3.1, 8.1) → Single property for all token types
- Token expiration properties (2.3, 3.3, 8.6) → Single property for time-based expiration
- Rate limiting properties (5.1-5.4, 3.6) → Single property for rate limiting algorithm
- Password validation properties (9.1-9.8) → Single comprehensive property
- CSRF validation (8.4) and token validation (2.6) → Similar validation patterns

**Properties Excluded** (covered by integration/example tests):
- UI rendering and interaction (frontend components)
- HTTP response codes and headers (integration tests)
- Database operations (integration tests)
- Email service calls (integration tests with mocks)
- Configuration and startup checks (smoke tests)

### Property 1: Token Uniqueness and Format

*For any* sequence of token generation requests (password reset, email verification, or CSRF), all generated tokens SHALL be unique and meet the required format (32 bytes, URL-safe base64 encoding).

**Validates: Requirements 2.1, 3.1, 8.1**

### Property 2: Token Expiration Calculation

*For any* token type and creation timestamp, the expiration check SHALL correctly determine if the token is expired based on the current time and the token type's expiration duration (1 hour for password reset and CSRF, 24 hours for email verification).

**Validates: Requirements 2.3, 3.3, 8.6**

### Property 3: Token Single-Use Enforcement

*For any* token, after it is successfully consumed once, all subsequent attempts to use the same token SHALL be rejected regardless of expiration status.

**Validates: Requirements 2.4**

### Property 4: Token Validation Correctness

*For any* token state (valid, expired, used, malformed, or non-existent), the validation function SHALL return the correct result: accept only tokens that are valid, not expired, and not used.

**Validates: Requirements 2.6**

### Property 5: Rate Limiting Algorithm Correctness

*For any* sequence of requests with timestamps and any rate limit configuration (max requests, window duration), the rate limiter SHALL correctly allow or deny each request based on the number of requests within the sliding time window.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 3.6**

### Property 6: Retry-After Calculation

*For any* rate limit state (current count, window start time, max requests, window duration), the retry-after calculation SHALL return the correct number of seconds until the next request will be allowed.

**Validates: Requirements 5.6**

### Property 7: Account Lockout Threshold

*For any* sequence of login attempts (success or failure), the account lockout logic SHALL lock the account when and only when the number of consecutive failed attempts reaches the threshold (5), and SHALL reset the counter to zero on successful login.

**Validates: Requirements 6.2, 6.4**

### Property 8: Account Unlock Time Calculation

*For any* lockout timestamp and current time, the unlock check SHALL correctly determine if the lockout period (30 minutes) has elapsed and the account should be unlocked.

**Validates: Requirements 6.5**

### Property 9: Secret Generation Entropy

*For any* sequence of secret generation calls, all generated secrets SHALL be unique, at least 32 characters long, and have high entropy (minimum 128 bits).

**Validates: Requirements 7.4**

### Property 10: CSRF Token Validation

*For any* pair of tokens (cookie token and header token), the CSRF validation SHALL accept the request if and only if both tokens are present, not expired, and match exactly (constant-time comparison).

**Validates: Requirements 8.4**

### Property 11: Password Length Requirement

*For any* password string, the validator SHALL reject passwords shorter than 12 characters and accept passwords of 12 or more characters (assuming other requirements are met).

**Validates: Requirements 9.1**

### Property 12: Password Character Class Requirements

*For any* password string, the validator SHALL require at least one character from each class (uppercase letter, lowercase letter, number, special character) and SHALL correctly identify which requirements are not met.

**Validates: Requirements 9.2, 9.3, 9.4, 9.5**

### Property 13: Common Password Rejection

*For any* password string, if the password exists in the common password list (case-insensitive comparison), the validator SHALL reject it.

**Validates: Requirements 9.6**

### Property 14: Email Address in Password Rejection

*For any* email address and password string, if the password contains the email address (or the local part before @) as a substring (case-insensitive), the validator SHALL reject it.

**Validates: Requirements 9.7**

### Property 15: Password Validation Error Messages

*For any* invalid password, the validation result SHALL include specific error messages for each failed requirement, and the set of error messages SHALL exactly match the set of failed requirements.

**Validates: Requirements 9.8**

### Property 16: Session Expiration Extension

*For any* session with an expiration time and an activity timestamp, extending the session SHALL set the new expiration time to the activity timestamp plus the session timeout duration (24 hours or 30 days for remember-me).

**Validates: Requirements 10.2, 10.6**

### Property 17: Authentication Error Classification

*For any* authentication failure scenario (invalid email, invalid password, unverified email, locked account, expired session), the error classification logic SHALL return the correct error type and code.

**Validates: Requirements 12.1, 12.2**

### Property 18: Email Retry Backoff Calculation

*For any* retry attempt number (1, 2, or 3), the exponential backoff calculation SHALL return the correct delay: 2^(attempt-1) seconds (1s, 2s, 4s).

**Validates: Requirements 15.2**

### Property 19: Email Address Validation

*For any* string, the email validator SHALL correctly determine if it is a valid email address according to RFC 5322 simplified rules (local@domain format with valid characters).

**Validates: Requirements 15.7**

### Property 20: Email Template Variable Substitution

*For any* customer data (name, email) and template type, the template rendering SHALL include the customer's name in the personalization when available, and SHALL handle missing names gracefully.

**Validates: Requirements 15.5**

## Testing Strategy (Continued)

### Property-Based Test Implementation

Each correctness property will be implemented as a property-based test using fast-check with the following structure:

```typescript
import fc from 'fast-check';

describe('Feature: robust-authentication-system, Property 1: Token Uniqueness and Format', () => {
  it('should generate unique tokens with correct format', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(null), { minLength: 100, maxLength: 100 }),
        (requests) => {
          const tokens = requests.map(() => generateToken());
          
          // All tokens should be unique
          const uniqueTokens = new Set(tokens);
          expect(uniqueTokens.size).toBe(tokens.length);
          
          // All tokens should match format (32 bytes, base64url)
          tokens.forEach(token => {
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect(Buffer.from(token, 'base64url').length).toBe(32);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Test Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with feature name and property number
- Use appropriate generators for each property (timestamps, strings, numbers, etc.)
- Include edge cases in generators (empty strings, boundary values, special characters)

### Test Coverage Goals

- **Unit Tests**: 80% code coverage for pure functions
- **Integration Tests**: All critical user flows covered
- **Property Tests**: All 20 correctness properties verified
- **E2E Tests**: Complete authentication flows from UI to database

### Testing Tools

- **Jest**: Test runner and assertion library
- **fast-check**: Property-based testing library
- **Testcontainers**: Docker containers for integration tests (PostgreSQL, Redis)
- **Supertest**: HTTP endpoint testing
- **React Testing Library**: Frontend component testing
- **MSW (Mock Service Worker)**: API mocking for frontend tests


## API Endpoints

### Authentication Endpoints

#### POST /auth/customer/emailpass/register
Register a new customer account.

**Request Body**:
```typescript
{
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}
```

**Response**: 201 Created
```typescript
{
  customer: {
    id: string;
    email: string;
    email_verified: boolean;
    first_name?: string;
    last_name?: string;
    created_at: string;
  }
}
```

**Errors**:
- 400: Validation error (weak password, invalid email)
- 409: Email already registered
- 429: Rate limit exceeded

#### POST /auth/customer/emailpass
Login with email and password.

**Request Body**:
```typescript
{
  email: string;
  password: string;
  remember_me?: boolean;
}
```

**Response**: 200 OK + Set-Cookie
```typescript
{
  customer: {
    id: string;
    email: string;
    email_verified: boolean;
    first_name?: string;
    last_name?: string;
  }
}
```

**Errors**:
- 401: Invalid credentials
- 403: Account locked or email not verified
- 429: Rate limit exceeded

#### POST /auth/customer/emailpass/logout
Logout and invalidate current session.

**Response**: 200 OK
```typescript
{
  message: "Logged out successfully"
}
```

#### POST /auth/customer/emailpass/reset-password
Request password reset email.

**Request Body**:
```typescript
{
  email: string;
}
```

**Response**: 200 OK (always, to prevent email enumeration)
```typescript
{
  message: "If an account exists with this email, a password reset link has been sent"
}
```

**Errors**:
- 429: Rate limit exceeded

#### POST /auth/customer/emailpass/reset-password/confirm
Complete password reset with token.

**Request Body**:
```typescript
{
  token: string;
  password: string;
}
```

**Response**: 200 OK
```typescript
{
  message: "Password reset successfully"
}
```

**Errors**:
- 400: Invalid or expired token
- 400: Weak password

#### POST /auth/customer/emailpass/verify-email
Verify email address with token.

**Request Body**:
```typescript
{
  token: string;
}
```

**Response**: 200 OK
```typescript
{
  message: "Email verified successfully"
}
```

**Errors**:
- 400: Invalid or expired token

#### POST /auth/customer/emailpass/resend-verification
Resend email verification email.

**Response**: 200 OK
```typescript
{
  message: "Verification email sent"
}
```

**Errors**:
- 401: Not authenticated
- 429: Rate limit exceeded

### Account Management Endpoints

#### GET /store/customers/me
Get current customer profile.

**Response**: 200 OK
```typescript
{
  customer: {
    id: string;
    email: string;
    email_verified: boolean;
    first_name?: string;
    last_name?: string;
    created_at: string;
    last_login_at?: string;
  }
}
```

**Errors**:
- 401: Not authenticated

#### PATCH /store/customers/me
Update customer profile.

**Request Body**:
```typescript
{
  first_name?: string;
  last_name?: string;
  email?: string; // Requires re-verification
}
```

**Response**: 200 OK
```typescript
{
  customer: {
    id: string;
    email: string;
    email_verified: boolean;
    first_name?: string;
    last_name?: string;
  }
}
```

**Errors**:
- 401: Not authenticated
- 400: Validation error

#### POST /store/customers/me/change-password
Change customer password.

**Request Body**:
```typescript
{
  current_password: string;
  new_password: string;
}
```

**Response**: 200 OK
```typescript
{
  message: "Password changed successfully"
}
```

**Errors**:
- 401: Not authenticated
- 400: Invalid current password or weak new password

#### GET /store/customers/me/sessions
List active sessions.

**Response**: 200 OK
```typescript
{
  sessions: Array<{
    id: string;
    device_info?: {
      browser: string;
      os: string;
      device: string;
    };
    ip_address: string;
    last_activity_at: string;
    created_at: string;
    is_current: boolean;
  }>
}
```

**Errors**:
- 401: Not authenticated

#### DELETE /store/customers/me/sessions/:id
Revoke a specific session.

**Response**: 200 OK
```typescript
{
  message: "Session revoked successfully"
}
```

**Errors**:
- 401: Not authenticated
- 404: Session not found

#### DELETE /store/customers/me/sessions
Revoke all other sessions (except current).

**Response**: 200 OK
```typescript
{
  message: "All other sessions revoked successfully",
  revoked_count: number
}
```

**Errors**:
- 401: Not authenticated

### CSRF Token Endpoint

#### GET /auth/csrf-token
Get CSRF token for authentication forms.

**Response**: 200 OK + Set-Cookie
```typescript
{
  token: string;
}
```

## Security Considerations

### 1. Password Security

- **Hashing**: Use bcrypt with cost factor 12 for password hashing
- **Timing attacks**: Use constant-time comparison for password verification
- **Password history**: Store hash of last 3 passwords to prevent reuse
- **Minimum entropy**: Enforce minimum password entropy (40 bits)

### 2. Session Security

- **Token storage**: Store JWT in HTTP-only, Secure, SameSite=Strict cookies
- **Token rotation**: Rotate session tokens on privilege escalation
- **Session binding**: Bind sessions to IP address and user agent (optional, configurable)
- **Concurrent sessions**: Limit to 5 active sessions per customer

### 3. Rate Limiting Strategy

- **Distributed**: Use Redis for rate limiting across multiple backend instances
- **Sliding window**: Implement sliding window algorithm for accurate rate limiting
- **Multiple keys**: Rate limit by IP, email, and customer ID as appropriate
- **Bypass for trusted IPs**: Allow whitelist of trusted IP ranges (admin access)

### 4. CSRF Protection

- **Double-submit cookie**: Use double-submit cookie pattern with SameSite=Strict
- **Token rotation**: Rotate CSRF tokens on each form load
- **Origin validation**: Validate Origin and Referer headers as additional protection
- **Exempt safe methods**: Only protect state-changing methods (POST, PUT, DELETE, PATCH)

### 5. Account Lockout

- **Progressive delays**: Implement progressive delays before lockout (1s, 2s, 5s, 10s, 30s)
- **IP-based tracking**: Track failed attempts by IP to prevent distributed attacks
- **Manual unlock**: Provide admin endpoint to manually unlock accounts
- **Notification**: Send email notification on account lockout

### 6. Token Security

- **Cryptographic randomness**: Use crypto.randomBytes() for token generation
- **Token hashing**: Store hashed tokens in database (bcrypt)
- **Token length**: Minimum 32 bytes (256 bits) for all tokens
- **Token cleanup**: Background job to clean up expired tokens every hour

### 7. Email Security

- **SPF/DKIM/DMARC**: Configure email authentication records
- **Rate limiting**: Limit email sends to prevent abuse (3 per hour per customer)
- **Link expiration**: Short expiration times for email links (1 hour for password reset)
- **Unsubscribe**: Include unsubscribe link in transactional emails (where applicable)

### 8. Audit Logging

- **PII protection**: Hash or encrypt sensitive data in audit logs
- **Tamper protection**: Use append-only storage for audit logs
- **Retention**: 90-day retention with automatic cleanup
- **Monitoring**: Set up alerts for suspicious patterns (multiple failed logins, account lockouts)

### 9. Input Validation

- **Email validation**: RFC 5322 compliant email validation
- **SQL injection**: Use parameterized queries for all database operations
- **XSS prevention**: Sanitize all user input before display
- **Path traversal**: Validate and sanitize file paths

### 10. Security Headers

All authentication responses include:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Deployment Considerations

### Environment Variables

Required environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/medusa

# Redis
REDIS_URL=redis://localhost:6379

# Secrets (minimum 32 characters)
JWT_SECRET=<cryptographically-secure-random-string>
COOKIE_SECRET=<cryptographically-secure-random-string>

# Email Service
EMAIL_PROVIDER=resend
EMAIL_API_KEY=<resend-api-key>
EMAIL_FROM_ADDRESS=noreply@likhangpinas.com
EMAIL_FROM_NAME="Likhang Pinas"

# CORS
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:9000
AUTH_CORS=http://localhost:3000

# Feature Flags
ENABLE_EMAIL_VERIFICATION=true
ENABLE_ACCOUNT_LOCKOUT=true
ENABLE_RATE_LIMITING=true
```

### Database Migrations

Migration files to create:
1. `001_add_email_verification_to_customers.sql`
2. `002_add_lockout_fields_to_customers.sql`
3. `003_create_sessions_table.sql`
4. `004_create_auth_tokens_table.sql`
5. `005_create_audit_events_table.sql`
6. `006_add_indexes_for_performance.sql`

### Redis Configuration

Recommended Redis configuration:
- **Persistence**: Enable RDB snapshots for rate limit data
- **Memory policy**: `allkeys-lru` for automatic eviction
- **Max memory**: 256MB minimum for rate limiting
- **Connection pool**: 10 connections per backend instance

### Monitoring and Alerts

Set up monitoring for:
- **Failed login rate**: Alert if > 100 failed logins per minute
- **Account lockout rate**: Alert if > 10 lockouts per hour
- **Email delivery failures**: Alert if > 5% failure rate
- **Session creation rate**: Alert if > 1000 sessions per minute
- **Rate limit hits**: Alert if > 50% of requests are rate limited
- **Database connection pool**: Alert if > 80% utilization
- **Redis connection pool**: Alert if > 80% utilization

### Performance Optimization

1. **Database indexes**: Create indexes on frequently queried columns
2. **Connection pooling**: Use connection pooling for database and Redis
3. **Caching**: Cache common password list in memory
4. **Async operations**: Use background jobs for email sending and audit logging
5. **CDN**: Serve static assets (frontend) from CDN

### Backup and Recovery

1. **Database backups**: Daily automated backups with 30-day retention
2. **Redis backups**: RDB snapshots every 6 hours
3. **Audit log archival**: Archive logs older than 90 days to cold storage
4. **Disaster recovery**: Document recovery procedures for data loss scenarios

## Migration Strategy

### Phase 1: Backend Infrastructure (Week 1)
1. Set up Redis for rate limiting and CSRF tokens
2. Create database migrations for new tables
3. Implement core services (SessionManager, TokenService, PasswordValidator)
4. Add middleware (RateLimiter, CSRFProtection)
5. Write unit tests for pure functions

### Phase 2: Authentication Endpoints (Week 2)
1. Implement logout endpoint
2. Implement password reset flow (request + confirm)
3. Implement email verification flow
4. Add audit logging to all endpoints
5. Write integration tests for authentication flows

### Phase 3: Account Management (Week 3)
1. Implement profile update endpoint
2. Implement password change endpoint
3. Implement session management endpoints
4. Add email service integration
5. Write integration tests for account management

### Phase 4: Frontend Implementation (Week 4)
1. Update auth pages with new features (logout, password reset, email verification)
2. Implement account management UI
3. Add password strength indicator
4. Add password visibility toggle
5. Improve error handling and messaging
6. Write frontend unit tests

### Phase 5: Security Hardening (Week 5)
1. Implement strong secret enforcement
2. Add security headers middleware
3. Configure CSRF protection for all endpoints
4. Set up monitoring and alerts
5. Conduct security audit and penetration testing

### Phase 6: Testing and Deployment (Week 6)
1. Write property-based tests for all correctness properties
2. Conduct load testing for rate limiting
3. Test email delivery with real email service
4. Deploy to staging environment
5. Conduct user acceptance testing
6. Deploy to production with feature flags

## Open Questions and Future Enhancements

### Open Questions
1. Should we implement OAuth2/OIDC for social login (Google, Facebook)?
2. Should we support multi-factor authentication (TOTP, SMS)?
3. Should we implement passwordless authentication (magic links)?
4. What is the acceptable session timeout for mobile apps?
5. Should we implement device fingerprinting for additional security?

### Future Enhancements
1. **Multi-factor authentication**: Add TOTP-based 2FA
2. **Social login**: OAuth2 integration with Google, Facebook, Apple
3. **Passwordless authentication**: Magic link login via email
4. **Biometric authentication**: WebAuthn support for fingerprint/face ID
5. **Advanced fraud detection**: Machine learning-based anomaly detection
6. **Account recovery**: Security questions or backup codes
7. **Session management**: Push notifications for new session creation
8. **Privacy features**: Data export and account deletion
9. **Admin dashboard**: View and manage customer accounts, audit logs
10. **API rate limiting**: Per-customer API rate limits for authenticated endpoints

## Conclusion

This design provides a comprehensive, secure, and scalable authentication system for the Likhang Pinas e-commerce platform. The implementation follows security best practices, includes extensive testing (unit, integration, and property-based tests), and provides a solid foundation for future enhancements.

Key design decisions:
- **Security-first approach**: Multiple layers of defense (rate limiting, CSRF, account lockout, strong passwords)
- **Testability**: Pure functions for validation logic, dependency injection for services
- **Scalability**: Redis-based rate limiting, stateless JWT sessions, connection pooling
- **User experience**: Clear error messages, password strength feedback, session management
- **Operational excellence**: Audit logging, monitoring, automated backups

The phased migration strategy allows for incremental delivery of features while maintaining system stability and security throughout the implementation process.
