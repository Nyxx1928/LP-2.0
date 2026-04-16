/**
 * Migration: Create Auth Tokens Table
 * 
 * This migration creates a table to store temporary authentication tokens
 * used for password resets and email verification.
 * 
 * Token Flow Example (Password Reset):
 * 1. User clicks "Forgot Password"
 * 2. We generate a random token and store it in this table
 * 3. We email the user a link with the token
 * 4. User clicks the link
 * 5. We verify the token exists, hasn't expired, and hasn't been used
 * 6. User sets new password
 * 7. We mark the token as "used" so it can't be reused
 * 
 * Why separate table instead of storing in customer table?
 * - A customer might request multiple tokens (resend verification email)
 * - Tokens are temporary and should be cleaned up regularly
 * - Different token types have different expiration times
 * - Easier to audit token usage
 */

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260416000003 extends Migration {
  async up(): Promise<void> {
    /**
     * Create the auth_tokens table
     * 
     * Columns Explained:
     * - id: Unique identifier for the token record
     * - type: What kind of token? ('password_reset' or 'email_verification')
     * - customer_id: Which customer requested this token (can be NULL for password reset if email doesn't exist)
     * - email: Email address associated with this token
     * - token_hash: Hashed version of the actual token (NEVER store raw tokens!)
     * - used: Has this token been consumed? (prevents reuse)
     * - created_at: When was this token generated?
     * - expires_at: When does this token expire?
     * 
     * Why hash the token?
     * If someone gains access to our database, they shouldn't be able to
     * use the tokens to reset passwords or verify emails. Hashing prevents this.
     */
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "auth_token" (
        "id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "email" TEXT NOT NULL,
        "token_hash" TEXT NOT NULL,
        "used" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at" TIMESTAMPTZ NOT NULL,
        
        CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "auth_token_type_check" CHECK ("type" IN ('password_reset', 'email_verification'))
      );
    `);

    /**
     * Create indexes for query performance
     * 
     * Index Strategy:
     * - token_hash: Most common query - "Is this token valid?"
     * - email + type: Find all tokens for an email (for rate limiting)
     * - expires_at: Cleanup job to delete expired tokens
     */

    // Index on token_hash: Validate tokens quickly
    // UNIQUE: Each token can only exist once
    // This is the most critical index - used on every token validation!
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_auth_token_token_hash" 
      ON "auth_token" ("token_hash");
    `);

    // Composite index on email + type: Find all tokens of a specific type for an email
    // Use case: Rate limiting - "Has this email requested too many password resets?"
    // Composite index: Combines multiple columns for efficient queries on both
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_token_email_type" 
      ON "auth_token" ("email", "type");
    `);

    // Index on expires_at: Find expired tokens for cleanup
    // Use case: Background job that runs daily to delete old tokens
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_token_expires_at" 
      ON "auth_token" ("expires_at");
    `);

    // Index on customer_id: Find all tokens for a customer
    // Use case: When a customer changes their email, invalidate all their tokens
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_token_customer_id" 
      ON "auth_token" ("customer_id") 
      WHERE "customer_id" IS NOT NULL;
    `);

    /**
     * Create foreign key constraint
     * 
     * Note: customer_id can be NULL because:
     * - Password reset tokens can be requested for non-existent emails
     *   (we don't want to reveal if an email exists in our system - security!)
     * - We still want to store the token to prevent abuse (rate limiting)
     * 
     * ON DELETE CASCADE: If a customer is deleted, delete their tokens
     * ON UPDATE CASCADE: If a customer's ID changes, update the token's customer_id
     */
    this.addSql(`
      ALTER TABLE IF EXISTS "auth_token" 
      ADD CONSTRAINT "auth_token_customer_id_foreign" 
      FOREIGN KEY ("customer_id") 
      REFERENCES "customer" ("id") 
      ON UPDATE CASCADE 
      ON DELETE CASCADE;
    `);
  }

  /**
   * down() - Revert the migration
   * 
   * Clean up in reverse order:
   * 1. Drop foreign key constraint
   * 2. Drop the table (indexes are automatically dropped)
   */
  async down(): Promise<void> {
    // Drop foreign key constraint
    this.addSql(`
      ALTER TABLE IF EXISTS "auth_token" 
      DROP CONSTRAINT IF EXISTS "auth_token_customer_id_foreign";
    `);

    // Drop the table
    this.addSql(`DROP TABLE IF EXISTS "auth_token" CASCADE;`);
  }
}
