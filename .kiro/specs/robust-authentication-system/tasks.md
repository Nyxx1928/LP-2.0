# Implementation Plan: Robust Authentication System

## Overview

This implementation plan follows a 6-phase migration strategy to enhance the Likhang Pinas e-commerce authentication system. The current implementation provides basic email/password authentication via Medusa v2, but lacks critical security features, user management capabilities, and essential authentication flows.

The implementation will be built using TypeScript for both backend (Medusa v2/Node.js) and frontend (Next.js 15/React), with PostgreSQL for data persistence, Redis for rate limiting and caching, and Resend for transactional emails.

Each phase builds incrementally on the previous phase, with checkpoints to ensure stability before proceeding. Property-based tests validate universal correctness properties, while unit and integration tests verify specific examples and end-to-end flows.

## Tasks

### Phase 1: Backend Infrastructure

- [x] 1. Set up Redis infrastructure and configuration
  - Install Redis client library (@redis/client)
  - Create Redis connection manager with connection pooling
  - Add Redis configuration to environment variables (REDIS_URL)
  - Implement health check for Redis connection
  - _Requirements: 5.8, 8.2_

- [x] 2. Create database migrations for authentication tables
  - [x] 2.1 Create migration to add email verification fields to customers table
    - Add email_verified (boolean, default false)
    - Add failed_login_count (integer, default 0)
    - Add locked_until (timestamp, nullable)
    - Add last_login_at (timestamp, nullable)
    - _Requirements: 3.4, 6.2, 6.3_
  
  - [x] 2.2 Create sessions table migration
    - Create sessions table with id, customer_id, token_hash, remember_me, device_info, ip_address, user_agent, created_at, expires_at, last_activity_at
    - Add indexes on customer_id, expires_at, token_hash
    - Add foreign key constraint to customers table with CASCADE delete
    - _Requirements: 10.1, 10.6, 4.8_
  
  - [x] 2.3 Create auth_tokens table migration
    - Create auth_tokens table with id, type, customer_id, email, token_hash, used, created_at, expires_at
    - Add indexes on token_hash, email+type, expires_at
    - Add foreign key constraint to customers table with CASCADE delete
    - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.3_
  
  - [x] 2.4 Create audit_events table migration
    - Create audit_events table with id, event_type, customer_id, email, ip_address, user_agent, metadata, created_at
    - Add indexes on customer_id, email, event_type, created_at
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [ ] 3. Implement core service classes
  - [ ] 3.1 Implement PasswordValidator service
    - Create PasswordValidator class with validation logic
    - Implement validate() method checking length, character classes, common passwords, email substring
    - Implement calculateStrength() method for password entropy calculation
    - Load common password list (top 10,000) into memory
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  
  - [ ]* 3.2 Write property tests for PasswordValidator
    - **Property 11: Password Length Requirement**
    - **Property 12: Password Character Class Requirements**
    - **Property 13: Common Password Rejection**
    - **Property 14: Email Address in Password Rejection**
    - **Property 15: Password Validation Error Messages**
    - **Validates: Requirements 9.1-9.8**
  
  - [ ] 3.3 Implement TokenService for password reset and email verification
    - Create TokenService class with token generation and validation
    - Implement generatePasswordResetToken() with 1-hour expiration
    - Implement generateEmailVerificationToken() with 24-hour expiration
    - Implement validatePasswordResetToken() and validateEmailVerificationToken()
    - Implement consumeToken() to mark tokens as used
    - Store hashed tokens in database using bcrypt
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 3.1, 3.3, 3.4_
  
  - [ ]* 3.4 Write property tests for TokenService
    - **Property 1: Token Uniqueness and Format**
    - **Property 2: Token Expiration Calculation**
    - **Property 3: Token Single-Use Enforcement**
    - **Property 4: Token Validation Correctness**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.6, 3.1, 3.3**
  
  - [ ] 3.5 Implement SessionManager for JWT session management
    - Create SessionManager class with session creation and validation
    - Implement createSession() with JWT token generation
    - Implement validateSession() with token verification
    - Implement extendSession() for sliding expiration
    - Implement invalidateSession() and invalidateAllSessions()
    - Store session metadata in database for revocation
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 4.7_
  
  - [ ]* 3.6 Write property tests for SessionManager
    - **Property 16: Session Expiration Extension**
    - **Validates: Requirements 10.2, 10.6**

- [ ] 4. Implement middleware components
  - [ ] 4.1 Implement RateLimiter middleware
    - Create RateLimiter class using Redis for distributed rate limiting
    - Implement sliding window algorithm with INCR and EXPIRE
    - Configure different limits for login (5/15min), registration (3/hour), password reset (3/hour)
    - Return 429 status with Retry-After header when limit exceeded
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
  
  - [ ]* 4.2 Write property tests for RateLimiter
    - **Property 5: Rate Limiting Algorithm Correctness**
    - **Property 6: Retry-After Calculation**
    - **Validates: Requirements 5.1-5.6**
  
  - [ ] 4.3 Implement CSRFProtection middleware
    - Create CSRFProtection class with token generation and validation
    - Generate cryptographically secure 32-byte tokens
    - Store tokens in Redis with 1-hour expiration
    - Implement double-submit cookie pattern with SameSite=Strict
    - Validate tokens using constant-time comparison
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  
  - [ ]* 4.4 Write property tests for CSRFProtection
    - **Property 10: CSRF Token Validation**
    - **Validates: Requirements 8.4**
  
  - [ ] 4.5 Implement SecurityHeaders middleware
    - Create middleware to set security headers on all responses
    - Set Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Content-Security-Policy, Referrer-Policy
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [ ]* 5. Write unit tests for core services
  - Test PasswordValidator with valid/invalid passwords, edge cases
  - Test TokenService with token generation, validation, expiration, consumption
  - Test SessionManager with session creation, validation, extension, invalidation
  - Test RateLimiter with requests under/over limit, window expiration
  - Test CSRFProtection with valid/invalid tokens, expiration

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

### Phase 2: Authentication Endpoints

- [ ] 7. Implement logout endpoint
  - [ ] 7.1 Create POST /auth/customer/emailpass/logout route
    - Extract session token from cookie
    - Call SessionManager.invalidateSession()
    - Clear authentication cookies
    - Return 200 OK with success message
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ]* 7.2 Write integration test for logout flow
    - Test successful logout clears cookies and invalidates session
    - Test logout with invalid session returns appropriate error
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 8. Implement password reset flow
  - [ ] 8.1 Create POST /auth/customer/emailpass/reset-password route
    - Accept email address in request body
    - Apply rate limiting (3 requests per hour per email)
    - Generate password reset token via TokenService
    - Send password reset email (implement in Phase 3)
    - Return generic success message to prevent email enumeration
    - Log audit event
    - _Requirements: 2.1, 2.2, 2.7, 2.10, 5.3_
  
  - [ ] 8.2 Create POST /auth/customer/emailpass/reset-password/confirm route
    - Accept token and new password in request body
    - Validate token via TokenService
    - Validate new password via PasswordValidator
    - Update customer password with bcrypt hash
    - Consume token to mark as used
    - Invalidate all sessions except current
    - Log audit event
    - Return 200 OK on success
    - _Requirements: 2.4, 2.5, 2.6, 4.7, 14.5_
  
  - [ ]* 8.3 Write integration test for password reset flow
    - Test complete flow: request → email → confirm → login with new password
    - Test expired token rejection
    - Test used token rejection
    - Test weak password rejection
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [ ] 9. Implement email verification flow
  - [ ] 9.1 Create POST /auth/customer/emailpass/verify-email route
    - Accept token in request body
    - Validate token via TokenService
    - Mark customer email as verified in database
    - Consume token to mark as used
    - Log audit event
    - Return 200 OK on success
    - _Requirements: 3.4_
  
  - [ ] 9.2 Create POST /auth/customer/emailpass/resend-verification route
    - Require authentication
    - Apply rate limiting (3 requests per hour per customer)
    - Generate new email verification token via TokenService
    - Send verification email (implement in Phase 3)
    - Return 200 OK
    - _Requirements: 3.5, 3.6_
  
  - [ ] 9.3 Update registration endpoint to generate verification token
    - After successful registration, generate email verification token
    - Send verification email (implement in Phase 3)
    - _Requirements: 3.1, 3.2_
  
  - [ ]* 9.4 Write integration test for email verification flow
    - Test complete flow: register → receive email → verify → email_verified = true
    - Test expired token rejection
    - Test resend verification with rate limiting
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 10. Implement account lockout logic
  - [ ] 10.1 Update login endpoint with account lockout
    - Check if account is locked before authentication
    - Increment failed_login_count on failed login
    - Lock account for 30 minutes after 5 consecutive failures
    - Reset failed_login_count to 0 on successful login
    - Return error with lockout duration when account is locked
    - Log audit event when account is locked
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 14.6_
  
  - [ ]* 10.2 Write property tests for account lockout
    - **Property 7: Account Lockout Threshold**
    - **Property 8: Account Unlock Time Calculation**
    - **Validates: Requirements 6.2, 6.4, 6.5**
  
  - [ ]* 10.3 Write integration test for account lockout flow
    - Test 5 failed logins trigger lockout
    - Test locked account cannot login
    - Test successful login resets counter
    - Test automatic unlock after 30 minutes
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

- [ ] 11. Add audit logging to all authentication endpoints
  - Add audit logging to login (success and failure)
  - Add audit logging to logout
  - Add audit logging to password reset request and completion
  - Add audit logging to email verification
  - Add audit logging to account lockout
  - Include timestamp, customer ID, email, IP address, user agent
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [ ]* 12. Write integration tests for authentication endpoints
  - Test complete login flow with rate limiting
  - Test complete registration flow with email verification
  - Test CSRF protection on all endpoints
  - Test security headers on all responses
  - Test error handling for various failure scenarios

- [ ] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

### Phase 3: Account Management

- [ ] 14. Implement profile management endpoints
  - [ ] 14.1 Update GET /store/customers/me endpoint
    - Return customer profile with email_verified and last_login_at fields
    - Require authentication
    - _Requirements: 4.1, 4.2_
  
  - [ ] 14.2 Update PATCH /store/customers/me endpoint
    - Accept first_name, last_name, email in request body
    - Validate input fields
    - If email is changed, set email_verified to false and generate verification token
    - Save changes to database
    - Return updated customer profile
    - _Requirements: 4.3, 4.4_
  
  - [ ]* 14.3 Write integration test for profile management
    - Test profile retrieval
    - Test profile update with valid data
    - Test email change triggers re-verification
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 15. Implement password change endpoint
  - [ ] 15.1 Create POST /store/customers/me/change-password route
    - Require authentication
    - Accept current_password and new_password in request body
    - Verify current password matches
    - Validate new password via PasswordValidator
    - Update password with bcrypt hash
    - Invalidate all other sessions except current
    - Log audit event
    - Return 200 OK on success
    - _Requirements: 4.5, 4.6, 4.7, 14.4_
  
  - [ ]* 15.2 Write integration test for password change
    - Test successful password change with valid current password
    - Test rejection with invalid current password
    - Test rejection with weak new password
    - Test other sessions are invalidated
    - _Requirements: 4.5, 4.6, 4.7_

- [ ] 16. Implement session management endpoints
  - [ ] 16.1 Create GET /store/customers/me/sessions route
    - Require authentication
    - Query sessions table for customer's active sessions
    - Parse user agent to extract device info (browser, OS, device)
    - Mark current session with is_current flag
    - Return list of sessions with device info, IP, last activity, created date
    - _Requirements: 4.8_
  
  - [ ] 16.2 Create DELETE /store/customers/me/sessions/:id route
    - Require authentication
    - Verify session belongs to authenticated customer
    - Call SessionManager.invalidateSession()
    - Return 200 OK on success
    - _Requirements: 4.9_
  
  - [ ] 16.3 Create DELETE /store/customers/me/sessions route
    - Require authentication
    - Call SessionManager.invalidateAllSessions() with current session exception
    - Return count of revoked sessions
    - _Requirements: 4.10_
  
  - [ ]* 16.4 Write integration test for session management
    - Test listing active sessions
    - Test revoking individual session
    - Test revoking all other sessions
    - Test cannot revoke another customer's session
    - _Requirements: 4.8, 4.9, 4.10_

- [ ] 17. Implement email service integration
  - [ ] 17.1 Create EmailService class with Resend integration
    - Install Resend SDK
    - Create EmailService class with send() method
    - Implement exponential backoff retry logic (3 attempts: 1s, 2s, 4s)
    - Validate email addresses before sending
    - Log email delivery failures
    - _Requirements: 15.1, 15.2, 15.3, 15.7, 15.8_
  
  - [ ]* 17.2 Write property tests for EmailService
    - **Property 18: Email Retry Backoff Calculation**
    - **Property 19: Email Address Validation**
    - **Validates: Requirements 15.2, 15.7**
  
  - [ ] 17.3 Create email templates for transactional emails
    - Create password reset email template (HTML and plain text)
    - Create email verification template (HTML and plain text)
    - Create account locked notification template (HTML and plain text)
    - Include customer name personalization
    - _Requirements: 15.4, 15.5, 15.6_
  
  - [ ]* 17.4 Write property test for email template rendering
    - **Property 20: Email Template Variable Substitution**
    - **Validates: Requirements 15.5**
  
  - [ ] 17.5 Integrate EmailService with TokenService
    - Update generatePasswordResetToken() to send email
    - Update generateEmailVerificationToken() to send email
    - Send account locked notification when account is locked
    - _Requirements: 2.2, 3.2, 6.6_
  
  - [ ]* 17.6 Write integration test for email sending
    - Test password reset email is sent with correct content
    - Test email verification email is sent with correct content
    - Test account locked email is sent with correct content
    - Test retry logic on failure
    - _Requirements: 2.2, 3.2, 6.6, 15.2_

- [ ] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

### Phase 4: Frontend Implementation

- [ ] 19. Update authentication pages
  - [ ] 19.1 Add logout functionality to navigation
    - Add logout button to account navigation menu
    - Call logout API endpoint on click
    - Clear client-side auth state
    - Redirect to homepage with confirmation message
    - _Requirements: 1.3, 1.4, 1.5_
  
  - [ ] 19.2 Create forgot password page
    - Create form with email input
    - Add "Forgot Password" link to login page
    - Call password reset request API
    - Display success message (generic to prevent enumeration)
    - Handle rate limiting errors
    - _Requirements: 2.7, 2.8, 2.10_
  
  - [ ] 19.3 Create reset password confirmation page
    - Create form with token (from URL) and new password inputs
    - Add password visibility toggle
    - Add real-time password strength indicator
    - Call password reset confirm API
    - Display success message and redirect to login
    - Handle expired/invalid token errors
    - _Requirements: 2.9, 9.9, 9.10, 11.1, 11.2, 11.3_
  
  - [ ] 19.4 Create email verification banner component
    - Display banner for unverified customers
    - Add "Resend Verification Email" button
    - Call resend verification API
    - Display success message after resend
    - Handle rate limiting errors
    - _Requirements: 3.7, 3.8_
  
  - [ ] 19.5 Add email verification confirmation page
    - Extract token from URL query parameter
    - Call verify email API on page load
    - Display success or error message
    - Redirect to account page on success
    - _Requirements: 3.4_

- [ ] 20. Implement account management UI
  - [ ] 20.1 Create account profile page
    - Display current profile information (email, name, creation date, email verification status)
    - Create inline edit form for first_name and last_name
    - Create email change form with re-verification warning
    - Handle validation errors inline
    - Display success toast on save
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 20.2 Create change password form component
    - Create form with current_password and new_password inputs
    - Add password visibility toggles
    - Add real-time password strength indicator for new password
    - Call change password API
    - Display success message
    - Handle errors (invalid current password, weak new password)
    - _Requirements: 4.5, 4.6, 9.9, 9.10, 11.1, 11.2, 11.3, 11.4_
  
  - [ ] 20.3 Create active sessions list component
    - Fetch and display list of active sessions
    - Display device info (browser, OS, device), IP address, last activity
    - Mark current session visually
    - Add "Revoke" button for each session
    - Add "Revoke All Other Sessions" button
    - Show confirmation dialog for revoke actions
    - _Requirements: 4.8, 4.9, 4.10_

- [ ] 21. Add password strength indicator and visibility toggle
  - [ ] 21.1 Create PasswordStrengthIndicator component
    - Calculate password strength in real-time as user types
    - Display visual indicator (weak/medium/strong with colors)
    - Display specific validation errors (length, character classes, common password)
    - _Requirements: 9.9, 9.10_
  
  - [ ] 21.2 Create PasswordVisibilityToggle component
    - Add toggle button next to password input fields
    - Switch input type between password and text
    - Display appropriate icon (eye/eye-slash) for current state
    - Apply to all password fields (login, register, password change, password reset)
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [ ] 22. Improve error handling and messaging
  - [ ] 22.1 Create error message mapping
    - Map backend error codes to user-friendly messages
    - Distinguish between invalid email, invalid password, unverified email, locked account
    - Display account lockout duration in error message
    - Avoid exposing sensitive information
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 6.7_
  
  - [ ] 22.2 Implement field-level validation errors
    - Display validation errors inline with input fields
    - Display summary of all errors at top of form
    - Handle network errors with retry suggestion
    - _Requirements: 12.5, 12.6, 12.7_
  
  - [ ] 22.3 Handle rate limiting errors
    - Display user-friendly message when rate limit exceeded
    - Show retry-after time from response header
    - Disable submit button until retry time elapses
    - _Requirements: 5.7_

- [ ]* 23. Write frontend unit tests
  - Test PasswordStrengthIndicator with various password inputs
  - Test PasswordVisibilityToggle state changes
  - Test error message display for different error types
  - Test form validation and submission
  - Test session list rendering and revoke actions

- [ ] 24. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

### Phase 5: Security Hardening

- [ ] 25. Implement strong secret enforcement
  - [ ] 25.1 Create secret validation on backend startup
    - Check JWT_SECRET is at least 32 characters
    - Check COOKIE_SECRET is at least 32 characters
    - Refuse to start if secrets are too short
    - Generate cryptographically secure random secrets if not set
    - Log warning when using generated secrets
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [ ]* 25.2 Write property test for secret generation
    - **Property 9: Secret Generation Entropy**
    - **Validates: Requirements 7.4**
  
  - [ ]* 25.3 Write unit test for secret validation
    - Test startup fails with short secrets
    - Test startup succeeds with valid secrets
    - Test generated secrets meet requirements
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 26. Configure CSRF protection for all authentication endpoints
  - [ ] 26.1 Create GET /auth/csrf-token endpoint
    - Generate CSRF token
    - Store token in Redis with 1-hour expiration
    - Set token in HTTP-only cookie with SameSite=Strict
    - Return token in response body
    - _Requirements: 8.1, 8.2_
  
  - [ ] 26.2 Apply CSRF middleware to authentication endpoints
    - Apply to login, register, logout, password reset, password change, profile update
    - Validate CSRF token from cookie and header
    - Return 403 if token is missing or invalid
    - _Requirements: 8.3, 8.4, 8.5, 8.7_
  
  - [ ] 26.3 Update frontend to include CSRF tokens
    - Fetch CSRF token before form submission
    - Include token in X-CSRF-Token header
    - Handle 403 errors by refreshing token
    - _Requirements: 8.3_

- [ ] 27. Add security headers to all responses
  - Apply SecurityHeaders middleware to all authentication and account management routes
  - Verify headers are set correctly in responses
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [ ] 28. Set up monitoring and alerting
  - Configure monitoring for failed login rate (alert if > 100/min)
  - Configure monitoring for account lockout rate (alert if > 10/hour)
  - Configure monitoring for email delivery failures (alert if > 5% failure rate)
  - Configure monitoring for session creation rate (alert if > 1000/min)
  - Configure monitoring for rate limit hits (alert if > 50% of requests)
  - Configure monitoring for database and Redis connection pool utilization (alert if > 80%)
  - _Requirements: Operational Excellence_

- [ ]* 29. Conduct security audit
  - Review all authentication endpoints for security vulnerabilities
  - Test for SQL injection, XSS, CSRF, timing attacks
  - Verify rate limiting is effective
  - Verify account lockout prevents brute force
  - Verify CSRF protection is applied correctly
  - Verify security headers are set
  - Verify secrets are strong and properly configured

- [ ] 30. Checkpoint - Ensure all tests pass and security audit is complete
  - Ensure all tests pass, ask the user if questions arise.

### Phase 6: Testing and Deployment

- [ ]* 31. Write all remaining property-based tests
  - Verify all 20 correctness properties have corresponding property tests
  - Run all property tests with minimum 100 iterations
  - Fix any failures discovered by property tests
  - _Requirements: All correctness properties_

- [ ]* 32. Conduct load testing for rate limiting
  - Simulate high request volume to test rate limiting
  - Verify rate limiter correctly blocks requests over limit
  - Verify Redis handles concurrent rate limit checks
  - Verify retry-after headers are correct
  - Test with multiple backend instances (distributed rate limiting)

- [ ]* 33. Test email delivery with real email service
  - Send test emails for password reset, email verification, account lockout
  - Verify emails are delivered within 30 seconds
  - Verify email content is correct with personalization
  - Verify plain text versions are included
  - Test retry logic with simulated failures

- [ ] 34. Deploy to staging environment
  - Deploy backend with all migrations
  - Deploy frontend with updated UI
  - Configure environment variables (secrets, Redis, database, email service)
  - Run smoke tests to verify basic functionality
  - _Requirements: Deployment_

- [ ] 35. Conduct user acceptance testing
  - Test complete registration flow with email verification
  - Test login flow with rate limiting and account lockout
  - Test password reset flow end-to-end
  - Test account management (profile update, password change, session management)
  - Test logout functionality
  - Verify error messages are user-friendly
  - Verify password strength indicator works correctly
  - _Requirements: All user-facing requirements_

- [ ] 36. Deploy to production with feature flags
  - Enable feature flags for email verification, account lockout, rate limiting
  - Deploy backend to production
  - Deploy frontend to production
  - Monitor logs and metrics for errors
  - Gradually enable features for all users
  - _Requirements: Deployment_

- [ ] 37. Final checkpoint - Production deployment complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at the end of each phase
- Property tests validate universal correctness properties (20 properties total)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows
- All code will be written in TypeScript for both backend and frontend
- Backend uses Medusa v2 (Node.js), frontend uses Next.js 15 (React)
- Database is PostgreSQL, cache/rate limiting uses Redis, email service is Resend
