/**
 * Input sanitization utilities for security
 * Protects against XSS, SQL injection, and other injection attacks
 */

/**
 * Sanitize string input by removing/escaping dangerous characters
 * Prevents XSS attacks
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
    .replace(/['"]/g, (match) => (match === '"' ? '&quot;' : '&#x27;')) // Escape quotes
    .replace(/&/g, '&amp;') // Escape ampersand
    .slice(0, 1000); // Limit length to prevent DoS
}

/**
 * Sanitize email input
 * Validates and normalizes email addresses
 */
export function sanitizeEmail(email: string): string {
  if (typeof email !== 'string') {
    return '';
  }

  const sanitized = email.trim().toLowerCase();
  
  // Basic email validation regex
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  
  if (!emailRegex.test(sanitized)) {
    throw new Error('Invalid email format');
  }

  return sanitized;
}

/**
 * Sanitize username input
 * Allows only alphanumeric characters, underscores, and hyphens
 */
export function sanitizeUsername(username: string): string {
  if (typeof username !== 'string') {
    return '';
  }

  const sanitized = username.trim().toLowerCase();
  
  // Only allow alphanumeric, underscore, and hyphen
  if (!/^[a-z0-9_-]+$/.test(sanitized)) {
    throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
  }

  if (sanitized.length < 3 || sanitized.length > 30) {
    throw new Error('Username must be between 3 and 30 characters');
  }

  return sanitized;
}

/**
 * Sanitize phone number input
 * Removes all non-numeric characters
 */
export function sanitizePhoneNumber(phone: string): string {
  if (typeof phone !== 'string') {
    return '';
  }

  // Remove all non-numeric characters
  const sanitized = phone.replace(/\D/g, '');

  if (sanitized.length < 10 || sanitized.length > 15) {
    throw new Error('Invalid phone number length');
  }

  return sanitized;
}

/**
 * Sanitize URL input
 * Validates and normalizes URLs
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') {
    return '';
  }

  const sanitized = url.trim();

  try {
    const urlObj = new URL(sanitized);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are allowed');
    }

    return urlObj.toString();
  } catch {
    throw new Error('Invalid URL format');
  }
}

/**
 * Sanitize numeric input
 * Ensures input is a valid number within optional bounds
 */
export function sanitizeNumber(
  input: string | number,
  options?: { min?: number; max?: number; integer?: boolean }
): number {
  const num = typeof input === 'string' ? parseFloat(input) : input;

  if (isNaN(num) || !isFinite(num)) {
    throw new Error('Invalid number');
  }

  if (options?.integer && !Number.isInteger(num)) {
    throw new Error('Number must be an integer');
  }

  if (options?.min !== undefined && num < options.min) {
    throw new Error(`Number must be at least ${options.min}`);
  }

  if (options?.max !== undefined && num > options.max) {
    throw new Error(`Number must be at most ${options.max}`);
  }

  return num;
}

/**
 * Sanitize object by removing null/undefined values and limiting depth
 * Prevents prototype pollution attacks
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  allowedKeys?: string[]
): Partial<T> {
  if (typeof obj !== 'object' || obj === null) {
    return {};
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip prototype pollution attempts
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    // If allowedKeys is provided, only include those keys
    if (allowedKeys && !allowedKeys.includes(key)) {
      continue;
    }

    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized as Partial<T>;
}

/**
 * Sanitize HTML content (basic - for production use a library like DOMPurify)
 * Removes script tags and dangerous attributes
 */
export function sanitizeHtml(html: string): string {
  if (typeof html !== 'string') {
    return '';
  }

  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // Remove event handlers
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/<iframe/gi, '') // Remove iframes
    .trim();
}

/**
 * Validate and sanitize JSON input
 */
export function sanitizeJson<T = any>(input: string): T {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  try {
    const parsed = JSON.parse(input);
    
    // Prevent prototype pollution
    if (parsed && typeof parsed === 'object') {
      delete parsed.__proto__;
      delete parsed.constructor;
      delete parsed.prototype;
    }

    return parsed;
  } catch {
    throw new Error('Invalid JSON format');
  }
}

/**
 * Rate limiting helper - tracks request counts per identifier
 */
export class RateLimiter {
  private requests: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 60000 // 1 minute
  ) {}

  check(identifier: string): boolean {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetAt) {
      this.requests.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      return false;
    }

    record.count++;
    return true;
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }
}
