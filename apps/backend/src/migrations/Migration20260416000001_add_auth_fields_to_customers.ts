/**
 * Migration: Add Authentication Fields to Customers Table
 * 
 * This migration extends the existing 'customers' table (managed by Medusa)
 * with additional fields needed for our robust authentication system.
 * 
 * Fields Added:
 * - email_verified: Track if the customer's email has been verified
 * - failed_login_count: Count consecutive failed login attempts (for account lockout)
 * - locked_until: Timestamp when account lockout expires
 * - last_login_at: Track when customer last successfully logged in
 * 
 * Why these fields?
 * - email_verified: Security - ensure customers own the email they registered with
 * - failed_login_count: Security - detect brute force attacks
 * - locked_until: Security - temporarily lock accounts after too many failed attempts
 * - last_login_at: Audit trail - know when accounts were last accessed
 */

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260416000001 extends Migration {
  /**
   * up() - Apply the migration (add columns)
   * 
   * This runs when you execute: npx medusa db:migrate
   * 
   * SQL Explanation:
   * - ALTER TABLE: Modify an existing table structure
   * - IF EXISTS: Only run if the table exists (safety check)
   * - ADD COLUMN IF NOT EXISTS: Add column only if it doesn't already exist (idempotent)
   * - DEFAULT: Set a default value for existing rows
   * - NULL: Allow the column to be empty (for locked_until and last_login_at)
   */
  async up(): Promise<void> {
    // Add email_verified column
    // Default to FALSE because existing customers haven't verified their email yet
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" 
       ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT FALSE;`
    );

    // Add failed_login_count column
    // Default to 0 because existing customers have no failed attempts
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" 
       ADD COLUMN IF NOT EXISTS "failed_login_count" INTEGER NOT NULL DEFAULT 0;`
    );

    // Add locked_until column
    // NULL means the account is not locked
    // TIMESTAMPTZ stores timestamp with timezone (important for global apps)
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" 
       ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ NULL;`
    );

    // Add last_login_at column
    // NULL for existing customers (we don't know when they last logged in)
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" 
       ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ NULL;`
    );

    // Create an index on locked_until for faster queries
    // Why? We'll frequently check "is this account locked?" which queries this column
    // Indexes make queries faster (like a book's index helps you find pages quickly)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_customer_locked_until" 
       ON "customer" ("locked_until") 
       WHERE locked_until IS NOT NULL;`
    );

    // Create an index on email_verified for faster queries
    // Why? We'll filter customers by verification status
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_customer_email_verified" 
       ON "customer" ("email_verified");`
    );
  }

  /**
   * down() - Revert the migration (remove columns)
   * 
   * This runs when you execute: npx medusa db:rollback
   * 
   * Important: Always implement down() so you can undo changes if needed
   * This is like an "undo" button for database changes
   */
  async down(): Promise<void> {
    // Drop indexes first (must drop before dropping columns)
    this.addSql(`DROP INDEX IF EXISTS "IDX_customer_locked_until";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_customer_email_verified";`);

    // Drop columns in reverse order
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" DROP COLUMN IF EXISTS "last_login_at";`
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" DROP COLUMN IF EXISTS "locked_until";`
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" DROP COLUMN IF EXISTS "failed_login_count";`
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "customer" DROP COLUMN IF EXISTS "email_verified";`
    );
  }
}
