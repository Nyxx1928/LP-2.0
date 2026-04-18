/**
 * Customer Created Subscriber
 * 
 * This subscriber listens to the 'customer.created' event and automatically
 * generates an email verification token when a new customer registers.
 * 
 * === WHY WE NEED THIS ===
 * 
 * Email verification is a critical security feature:
 * 1. Confirms the customer owns the email address
 * 2. Prevents account takeover via fake email registration
 * 3. Reduces spam and bot accounts
 * 4. Enables secure communication (password resets, order updates)
 * 
 * === HOW IT WORKS ===
 * 
 * Flow:
 * 1. Customer registers → Medusa creates customer record
 * 2. Medusa emits 'customer.created' event
 * 3. This subscriber catches the event
 * 4. We generate a verification token (24-hour expiration)
 * 5. Token is stored in database (hashed for security)
 * 6. TODO (Phase 3): Send email with verification link
 * 
 * === EVENT-DRIVEN ARCHITECTURE ===
 * 
 * Why use a subscriber instead of modifying the registration endpoint?
 * 
 * Pros:
 * - Separation of concerns (registration logic separate from email logic)
 * - Non-blocking (email generation doesn't slow down registration)
 * - Resilient (if email fails, registration still succeeds)
 * - Testable (can test registration and email verification independently)
 * 
 * Cons:
 * - Slightly more complex (need to understand event system)
 * - Eventual consistency (tiny delay between registration and email)
 * 
 * In our case, the pros outweigh the cons. Email verification is not
 * critical to the registration flow itself - it's a follow-up action.
 * 
 * === MEDUSA V2 EVENTS ===
 * 
 * Medusa emits events for core commerce operations:
 * - customer.created, customer.updated
 * - order.placed, order.completed
 * - product.created, product.updated
 * 
 * Subscribers are async functions that run when events are emitted.
 * They receive:
 * - event.data: The payload (in our case, the customer object)
 * - container: Medusa's dependency injection container
 * 
 * Requirements: 3.1, 3.2
 */

import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

/**
 * Customer Created Event Handler
 * 
 * This function is executed whenever a new customer is created.
 * 
 * @param event.data - The customer object that was just created
 * @param container - Medusa's dependency injection container
 */
export default async function handleCustomerCreated({
  event,
  container,
}: SubscriberArgs<{ id: string; email: string }>) {
  // Extract customer data from the event
  const { id: customerId, email } = event.data;

  // Get the logger service for debugging
  // Medusa provides a logger that respects your logging configuration
  const logger = container.resolve("logger");

  logger.info(
    `[Customer Created] Generating email verification token for customer ${customerId} (${email})`
  );

  try {
    // === STEP 1: Get database connection ===
    // 
    // We need to access the database to store the verification token.
    // Medusa uses a "container" pattern (similar to Spring/NestJS):
    // - Services are registered in the container
    // - We "resolve" them when needed
    // - This makes testing easier (can inject mocks)
    const manager = container.resolve("manager") as {
      create: (
        entity: string,
        data: Record<string, unknown>
      ) => Promise<unknown>;
    };

    // === STEP 2: Create TokenService instance ===
    // 
    // TokenService is our custom service (not a Medusa built-in).
    // We need to manually instantiate it with its dependencies.
    // 
    // In a production app, we might register this as a Medusa service,
    // but for now we create it on-demand.
    const { TokenService } = await import("../lib/token-service.js");

    // Create database adapter for TokenService
    const tokenDb = {
      async createToken(tokenData: any) {
        const id = `token_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        await manager.create("auth_token", {
          id,
          type: tokenData.type,
          customer_id: tokenData.customerId,
          email: tokenData.email,
          token_hash: tokenData.tokenHash,
          used: tokenData.used,
          expires_at: tokenData.expiresAt,
          created_at: new Date(),
        });

        return {
          id,
          ...tokenData,
          createdAt: new Date(),
        };
      },
      async findTokenByHash() {
        return null;
      },
      async markTokenAsUsed() {
        return;
      },
      async deleteExpiredTokens() {
        return 0;
      },
      async countRecentTokens() {
        return 0;
      },
    };

    // Create TokenService with default config
    const tokenService = new TokenService(tokenDb);

    // === STEP 3: Generate email verification token ===
    // 
    // This creates:
    // - A cryptographically secure random token (32 bytes)
    // - Stores it in the database (hashed with bcrypt)
    // - Sets expiration to 24 hours from now
    // - Returns the raw token (to be sent in email)
    // 
    // The raw token is what we'll send to the customer.
    // We store the hashed version in the database for security.
    const token = await tokenService.generateEmailVerificationToken(
      email,
      customerId
    );

    logger.info(
      `[Customer Created] Email verification token generated for ${email}`
    );

    // === STEP 4: Send verification email ===
    // 
    // TODO (Phase 3): Integrate with email service
    // 
    // For now, we just log the token. In Phase 3, we'll:
    // 1. Create an EmailService
    // 2. Load email templates
    // 3. Send the email with the verification link
    // 
    // The verification link will look like:
    // https://yourstore.com/verify-email?token=<token>
    // 
    // When the customer clicks it, they'll be redirected to the
    // verify-email endpoint we created in Task 9.1
    logger.info(
      `[Customer Created] TODO: Send verification email to ${email} with token ${token}`
    );
    logger.info(
      `[Customer Created] Verification link: /verify-email?token=${token}`
    );

    // === WHAT HAPPENS NEXT? ===
    // 
    // 1. Customer receives email with verification link
    // 2. Customer clicks link → redirected to /verify-email?token=<token>
    // 3. Frontend calls POST /auth/customer/emailpass/verify-email
    // 4. Backend validates token and marks email as verified
    // 5. Customer can now access protected features
  } catch (error) {
    // === ERROR HANDLING ===
    // 
    // If token generation fails, we log the error but DON'T throw.
    // 
    // Why?
    // - The customer registration already succeeded
    // - We don't want to crash the registration flow
    // - The customer can always request a new verification email
    // 
    // In production, you might want to:
    // - Send an alert to your monitoring system
    // - Retry the operation
    // - Store failed attempts for manual review
    logger.error(
      `[Customer Created] Failed to generate verification token for ${email}:`,
      error
    );
  }
}

/**
 * Subscriber Configuration
 * 
 * This tells Medusa which event to listen to and provides metadata.
 */
export const config: SubscriberConfig = {
  // The event we're listening to
  // In Medusa v2, customer creation emits 'customer.created'
  event: "customer.created",
};
