/**
 * Example: How to use input sanitization in authentication routes
 * 
 * This file demonstrates best practices for sanitizing user input
 * in authentication endpoints to prevent security vulnerabilities.
 */

import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import {
  sanitizeEmail,
  sanitizeString,
  sanitizeUsername,
  RateLimiter,
} from '../../../lib/sanitization';

// Create rate limiter for login attempts
const loginRateLimiter = new RateLimiter(5, 15 * 60 * 1000); // 5 attempts per 15 minutes

/**
 * Example: Register endpoint with input sanitization
 */
export async function registerExample(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Type assertion for request body
    const body = req.body as Record<string, any>;

    // Extract and sanitize inputs
    const email = sanitizeEmail(body.email);
    const username = sanitizeUsername(body.username);
    const firstName = sanitizeString(body.first_name);
    const lastName = sanitizeString(body.last_name);

    // Validate password (don't sanitize passwords - validate length/complexity instead)
    const password = body.password;
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long',
      });
    }

    // TODO: Create user with sanitized data
    // const user = await createUser({ email, username, firstName, lastName, password });

    return res.status(201).json({
      message: 'User registered successfully',
      user: { email, username, firstName, lastName },
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid input',
    });
  }
}

/**
 * Example: Login endpoint with rate limiting and sanitization
 */
export async function loginExample(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Type assertion for request body
    const body = req.body as Record<string, any>;

    // Get client identifier for rate limiting (IP address)
    const clientId = req.ip || req.socket.remoteAddress || 'unknown';

    // Check rate limit
    if (!loginRateLimiter.check(clientId)) {
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
      });
    }

    // Sanitize email input
    const email = sanitizeEmail(body.email);
    const password = body.password;

    if (typeof password !== 'string') {
      return res.status(400).json({
        error: 'Invalid credentials',
      });
    }

    // TODO: Verify credentials
    // const user = await verifyCredentials(email, password);
    // if (!user) {
    //   return res.status(401).json({ error: 'Invalid credentials' });
    // }

    // Reset rate limiter on successful login
    loginRateLimiter.reset(clientId);

    return res.status(200).json({
      message: 'Login successful',
      user: { email },
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid input',
    });
  }
}

/**
 * Example: Update profile endpoint with field whitelisting
 */
export async function updateProfileExample(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Type assertion for request body
    const body = req.body as Record<string, any>;

    // Only allow specific fields to be updated
    const allowedFields = ['first_name', 'last_name', 'phone'];
    const updates: Record<string, string> = {};

    if (body.first_name) {
      updates.first_name = sanitizeString(body.first_name);
    }

    if (body.last_name) {
      updates.last_name = sanitizeString(body.last_name);
    }

    if (body.phone) {
      // Phone sanitization would go here
      updates.phone = sanitizeString(body.phone);
    }

    // Ignore any other fields that might be in the request
    // This prevents users from updating fields they shouldn't (e.g., role, permissions)

    // TODO: Update user profile
    // await updateUser(userId, updates);

    return res.status(200).json({
      message: 'Profile updated successfully',
      updates,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid input',
    });
  }
}

/**
 * Example: Search endpoint with sanitization to prevent injection
 */
export async function searchExample(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Sanitize search query
    const query = sanitizeString(req.query.q as string);

    if (!query || query.length < 2) {
      return res.status(400).json({
        error: 'Search query must be at least 2 characters',
      });
    }

    // TODO: Perform search with sanitized query
    // Use parameterized queries to prevent SQL injection
    // const results = await searchProducts(query);

    return res.status(200).json({
      query,
      results: [],
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid input',
    });
  }
}
