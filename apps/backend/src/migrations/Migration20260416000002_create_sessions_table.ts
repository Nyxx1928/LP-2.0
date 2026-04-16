/**
 * Migration: Create Sessions Table
 * 
 * This migration creates a new 'sessions' table to store active user sessions.
 * 
 * Why do we need this?
 * - Track all active login sessions for each customer
 * - Allow customers to see where they're logged in (device, location, time)
 * - Enable session revocation (logout from specific devices)
 * - Support "Remember Me" functionality with different expiration times
 * 
 * Table Structure:
 * - id: Unique identifier for each session
 * - customer_id: Which customer owns this session (foreign key to customer table)
 * - token_hash: Hashed JWT token (we hash it for security - never store raw tokens!)
 * - remember_me: Boolean flag for extended session duration
 * - device_info: JSON data about the device (browser, OS, device type)
 * - ip_address: IP address where the session was created
 * - user_agent: Raw user agent string from the browser
 * - created_at: When the session was created
 * - expires_at: When the session expires
 * - last_activity_at: Last time this session was used (for sliding expiration)
 */

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260416000002 extends Migration {
  async up(): Promise<void> {
    /**
     * Create the sessions table
     * 
     * Column Types Explained:
     * - TEXT: Variable-length string (for IDs, hashes, IP addresses)
     * - BOOLEAN: True/false value
     * - JSONB: JSON data stored in binary format (faster than JSON type)
     * - TIMESTAMPTZ: Timestamp with timezone
     * - NOT NULL: This column must have a value
     * - NULL: This column can be empty
     * - DEFAULT NOW(): Automatically set to current time when row is created
     */
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "token_hash" TEXT NOT NULL,
        "remember_me" BOOLEAN NOT NULL DEFAULT FALSE,
        "device_info" JSONB NULL,
        "ip_address" TEXT NULL,
        "user_agent" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at" TIMESTAMPTZ NOT NULL,
        "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        CONSTRAINT "session_pkey" PRIMARY KEY ("id")
      );
    `);

    /**
     * Create indexes for faster queries
     * 
     * Why indexes?
     * Indexes are like a book's index - they help find data quickly.
     * Without indexes, the database has to scan every row (slow!).
     * With indexes, it can jump directly to the relevant rows (fast!).
     * 
     * Trade-off: Indexes make reads faster but writes slightly slower.
     * For sessions, we read much more than we write, so indexes are worth it.
     */

    // Index on customer_id: Find all sessions for a specific customer
    // Use case: "Show me all my active sessions"
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_session_customer_id" 
      ON "session" ("customer_id");
    `);

    // Index on token_hash: Validate a session token quickly
    // Use case: "Is this token valid?" (happens on every authenticated request!)
    // UNIQUE: Each token can only exist once (prevents duplicate sessions)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_session_token_hash" 
      ON "session" ("token_hash");
    `);

    // Index on expires_at: Find expired sessions for cleanup
    // Use case: Background job that deletes expired sessions
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expires_at" 
      ON "session" ("expires_at");
    `);

    /**
     * Create foreign key constraint
     * 
     * What is a foreign key?
     * It's a link between two tables. Here, we're saying:
     * "Every session MUST belong to a customer that exists in the customer table"
     * 
     * ON DELETE CASCADE: If a customer is deleted, automatically delete their sessions
     * Why? Orphaned sessions (sessions without a customer) are useless and waste space
     * 
     * ON UPDATE CASCADE: If a customer's ID changes, update the session's customer_id
     * (This rarely happens, but it's good practice to handle it)
     */
    this.addSql(`
      ALTER TABLE IF EXISTS "session" 
      ADD CONSTRAINT "session_customer_id_foreign" 
      FOREIGN KEY ("customer_id") 
      REFERENCES "customer" ("id") 
      ON UPDATE CASCADE 
      ON DELETE CASCADE;
    `);
  }

  /**
   * down() - Revert the migration
   * 
   * Order matters!
   * 1. Drop foreign key constraints first (can't drop a table that's referenced)
   * 2. Drop the table
   * 
   * CASCADE: Also drop anything that depends on this table
   */
  async down(): Promise<void> {
    // Drop foreign key constraint
    this.addSql(`
      ALTER TABLE IF EXISTS "session" 
      DROP CONSTRAINT IF EXISTS "session_customer_id_foreign";
    `);

    // Drop the entire table (indexes are automatically dropped with the table)
    this.addSql(`DROP TABLE IF EXISTS "session" CASCADE;`);
  }
}
