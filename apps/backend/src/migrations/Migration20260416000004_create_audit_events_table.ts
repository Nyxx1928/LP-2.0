/**
 * Migration: Create Audit Events Table
 * 
 * This migration creates a table to log all authentication-related events
 * for security monitoring, compliance, and incident investigation.
 * 
 * Why Audit Logging?
 * - Security: Detect brute force attacks, account takeovers, suspicious patterns
 * - Compliance: Many regulations require audit trails (GDPR, HIPAA, PCI-DSS, SOC 2)
 * - Debugging: Investigate issues ("Why was my account locked?")
 * - Forensics: Reconstruct what happened during a security incident
 * 
 * What We Log:
 * - Every login attempt (success and failure)
 * - Every logout
 * - Password changes and resets
 * - Email verification events
 * - Account lockouts and unlocks
 * 
 * Privacy & Retention:
 * - We log IP addresses and user agents (personal data under GDPR)
 * - We implement a 90-day retention policy (automatic cleanup)
 * - Logs are append-only (can't be modified after creation)
 */

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260416000004 extends Migration {
  async up(): Promise<void> {
    /**
     * Create the audit_events table
     * 
     * Columns Explained:
     * - id: Unique identifier for each event
     * - event_type: What happened? (login_success, login_failure, logout, etc.)
     * - customer_id: Which customer? (NULL for failed logins with non-existent email)
     * - email: Email address involved in the event
     * - ip_address: Where did the request come from?
     * - user_agent: What browser/device was used?
     * - metadata: Additional context (JSONB for flexibility)
     * - created_at: When did this happen?
     * 
     * Why JSONB for metadata?
     * Different events need different context:
     * - Login failure: reason (invalid password, account locked, etc.)
     * - Password change: whether other sessions were invalidated
     * - Account lockout: lockout duration
     * JSONB lets us store flexible data without changing the schema
     */
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "audit_event" (
        "id" TEXT NOT NULL,
        "event_type" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "email" TEXT NULL,
        "ip_address" TEXT NOT NULL,
        "user_agent" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "audit_event_type_check" CHECK ("event_type" IN (
          'login_success',
          'login_failure',
          'logout',
          'password_change',
          'password_reset_request',
          'password_reset_complete',
          'email_verification',
          'account_locked',
          'account_unlocked'
        ))
      );
    `);

    /**
     * Create indexes for query performance
     * 
     * Index Strategy:
     * - customer_id: "Show me all events for this customer"
     * - email: "Show me all events for this email" (even if customer doesn't exist)
     * - event_type: "Show me all failed login attempts"
     * - created_at: "Show me events from the last hour" + cleanup job
     * 
     * Why so many indexes?
     * Audit logs are queried in many different ways:
     * - Security team: "Show me all failed logins in the last hour"
     * - Customer support: "Show me this customer's login history"
     * - Compliance: "Export all events for this email address"
     * Each query pattern needs its own index for good performance
     */

    // Index on customer_id: Find all events for a specific customer
    // Use case: Customer support, user profile page showing login history
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_event_customer_id" 
      ON "audit_event" ("customer_id") 
      WHERE "customer_id" IS NOT NULL;
    `);

    // Index on email: Find all events for an email (even if customer doesn't exist)
    // Use case: Investigate suspicious activity on an email address
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_event_email" 
      ON "audit_event" ("email") 
      WHERE "email" IS NOT NULL;
    `);

    // Index on event_type: Find all events of a specific type
    // Use case: Security monitoring - "Show me all failed login attempts"
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_event_type" 
      ON "audit_event" ("event_type");
    `);

    // Index on created_at: Time-based queries and cleanup
    // Use case: "Show me events from the last hour" + daily cleanup job
    // DESC: Optimize for recent events (most common query pattern)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_event_created_at" 
      ON "audit_event" ("created_at" DESC);
    `);

    // Composite index on event_type + created_at: Efficient time-based filtering by type
    // Use case: "Show me all failed logins in the last 24 hours"
    // This is a common security monitoring query
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_event_type_created_at" 
      ON "audit_event" ("event_type", "created_at" DESC);
    `);

    /**
     * Create foreign key constraint
     * 
     * Note: customer_id can be NULL because:
     * - Failed login attempts might reference non-existent customers
     * - We still want to log these for security monitoring
     * 
     * ON DELETE SET NULL: If a customer is deleted, keep the audit log but set customer_id to NULL
     * Why SET NULL instead of CASCADE?
     * - Audit logs are for compliance and security
     * - We need to keep the record even if the customer is deleted
     * - We can still identify the event by email address
     */
    this.addSql(`
      ALTER TABLE IF EXISTS "audit_event" 
      ADD CONSTRAINT "audit_event_customer_id_foreign" 
      FOREIGN KEY ("customer_id") 
      REFERENCES "customer" ("id") 
      ON UPDATE CASCADE 
      ON DELETE SET NULL;
    `);
  }

  /**
   * down() - Revert the migration
   * 
   * Warning: Dropping audit logs means losing security and compliance data!
   * Only do this in development or if you have backups.
   */
  async down(): Promise<void> {
    // Drop foreign key constraint
    this.addSql(`
      ALTER TABLE IF EXISTS "audit_event" 
      DROP CONSTRAINT IF EXISTS "audit_event_customer_id_foreign";
    `);

    // Drop the table (indexes are automatically dropped)
    this.addSql(`DROP TABLE IF EXISTS "audit_event" CASCADE;`);
  }
}
