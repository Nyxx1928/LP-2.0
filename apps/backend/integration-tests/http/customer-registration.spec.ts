/**
 * Integration Tests for Customer Registration with Email Verification
 * 
 * These tests verify that when a customer registers, the system is set up
 * to handle email verification.
 * 
 * === WHAT WE'RE TESTING ===
 * 
 * Task 9.3: Update registration endpoint to generate verification token
 * 
 * Flow:
 * 1. Customer registers with email/password
 * 2. Medusa creates customer record
 * 3. Medusa emits 'customer.created' event
 * 4. Our subscriber catches event and generates verification token
 * 
 * Note: These tests verify the customer creation works. The token generation
 * is handled by the subscriber and will be tested in Phase 3 when we integrate
 * the email service.
 * 
 * Requirements: 3.1, 3.2
 */

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("Customer Registration with Email Verification", () => {
      /**
       * Test: Verify customer can be created
       * 
       * This verifies the basic registration flow works.
       * The subscriber will automatically generate a verification token
       * when the customer.created event is emitted.
       */
      it("should create customer successfully", async () => {
        const container = getContainer();
        const customerModule = container.resolve(Modules.CUSTOMER);

        const email = `test-${Date.now()}@example.com`;

        // Create customer (simulates registration)
        const customer = await customerModule.createCustomers({
          email,
          first_name: "Test",
          last_name: "User",
        });

        expect(customer).toBeDefined();
        expect(customer.id).toBeDefined();
        expect(customer.email).toBe(email);
        expect(customer.first_name).toBe("Test");
        expect(customer.last_name).toBe("User");

        // The subscriber will automatically generate a verification token
        // This happens asynchronously via the event system
        // In Phase 3, we'll add email service integration to send the email
      });

      /**
       * Test: Multiple customers can be created
       * 
       * Ensures the registration flow works for multiple customers.
       */
      it("should create multiple customers successfully", async () => {
        const container = getContainer();
        const customerModule = container.resolve(Modules.CUSTOMER);

        const email1 = `test1-${Date.now()}@example.com`;
        const email2 = `test2-${Date.now()}@example.com`;

        const customer1 = await customerModule.createCustomers({
          email: email1,
          first_name: "Test",
          last_name: "User1",
        });

        const customer2 = await customerModule.createCustomers({
          email: email2,
          first_name: "Test",
          last_name: "User2",
        });

        expect(customer1.id).toBeDefined();
        expect(customer2.id).toBeDefined();
        expect(customer1.id).not.toBe(customer2.id);
        expect(customer1.email).toBe(email1);
        expect(customer2.email).toBe(email2);
      });
    });
  },
});
