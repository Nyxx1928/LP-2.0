import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from '@medusajs/framework/http';
import { sanitizeObject } from '../../lib/sanitization';

/**
 * Middleware to sanitize request body
 * Removes dangerous properties and null/undefined values
 */
export function sanitizeRequestBody(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

/**
 * Middleware to sanitize query parameters
 */
export function sanitizeQueryParams(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  next();
}

/**
 * Middleware to validate and sanitize specific fields
 */
export function createFieldSanitizer(allowedFields: string[]) {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body, allowedFields);
    }
    next();
  };
}
