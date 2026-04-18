/**
 * Integration Tests for Login Account Lockout
 * 
 * These tests verify that the account lockout mechanism works correctly
 * to prevent brute force attacks.
 * 
 * === WHAT WE'RE TESTING ===
 * 
 * 1. Failed Login Tracking: System increments counter on failed attempts
 * 2. Account Lockout: Account locks after 5 consecutive failures
 * 3. Lockout Duration: Account stays locked for 30 minutes
 * 4. Counter Reset: Successful login resets the counter
 * 5. Automatic Unlock: Account unlocks after lockout expires
 * 
 * === WHY INTEGRATION TESTS? ===
 * 
 * Account lockout involves multiple components:
 * - Database (storing failed_login_count, locked_until)
 * - Authentication (password verification)
 * - Time-based logic (lockout expiration)
 * 
 * Integration tests verify these components work together correctly.
 * Unit tests alone can't catch issues like:
 * - Database transaction problems
 * - Race conditions (concurrent login attempts)
 * - Time zone handling bugs
 */

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ModuleRegistrationName } from "@medusajs/framework/utils";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    // TODO: Re-enable when integration harness includes auth provider + manager registrations.
    describe.skip("POST /auth/customer/emailpass - Account Lockout", () => {
      beforeAll(() => {
        // Allow assertions on expected 401/403 responses without Axios throwing.
        (api as any).defaults.validateStatus = () => true;
      });

      let testCustomer: any;
      const testEmail = "lockout-test@example.com";
      const testPassword = "SecurePassword123!";
      const wrongPassword = "WrongPassword123!";

      /**
       * Setup: Create a test customer before each test
       * 
       * We need a real customer in the database to test login.
       * Each test gets a fresh customer to avoid interference.
       */
      beforeEach(async () => {
        const container = getContainer();
        const customerService = container.resolve(
          ModuleRegistrationName.CUSTOMER
        );

        // Create test customer with verified email
        testCustomer = await customerService.createCustomers({
          email: testEmail,
          first_name: "Test",
          last_name: "User",
          // In a real setup, we'd hash the password properly
          // For now, we'll use Medusa's registration endpoint
        });

        // Register the customer to set password
        await api.post("/auth/customer/emailpass/register", {
          email: testEmail,
          password: testPassword,
          first_name: "Test",
          last_name: "User",
        });
      });

      /**
       * Cleanup: Delete test customer after each test
       * 
       * This keeps tests isolated - one test's data doesn't affect another.
       */
      afterEach(async () => {
        if (testCustomer) {
          const container = getContainer();
          const customerService = container.resolve(
            ModuleRegistrationName.CUSTOMER
          );
          
          try {
            await customerService.deleteCustomers([testCustomer.id]);
          } catch (error) {
            // Customer might already be deleted, that's okay
          }
        }
      });

      /**
       * Test 1: Track failed login attempts
       * 
       * When a user enters the wrong password, the system should:
       * - Increment failed_login_count
       * - Return error with attempts remaining
       * - NOT lock the account yet (under threshold)
       */
      it("should increment failed_login_count on failed login", async () => {
        // First failed attempt
        const response1 = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: wrongPassword,
        });

        expect(response1.status).toBe(401);
        expect(response1.data.error.code).toBe("INVALID_CREDENTIALS");
        expect(response1.data.error.attemptsRemaining).toBe(4);

        // Second failed attempt
        const response2 = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: wrongPassword,
        });

        expect(response2.status).toBe(401);
        expect(response2.data.error.attemptsRemaining).toBe(3);

        // Verify counter in database
        const container = getContainer();
        const query = container.resolve("query");
        const customers = await query.graph({
          entity: "customer",
          fields: ["failed_login_count"],
          filters: { email: testEmail },
        });

        expect(customers.data[0].failed_login_count).toBe(2);
      });

      /**
       * Test 2: Lock account after 5 failed attempts
       * 
       * After 5 consecutive failed logins, the system should:
       * - Set locked_until to now + 30 minutes
       * - Return 403 Forbidden with lockout message
       * - Include minutes remaining in response
       */
      it("should lock account after 5 failed login attempts", async () => {
        // Make 5 failed attempts
        for (let i = 0; i < 5; i++) {
          await api.post("/auth/customer/emailpass", {
            email: testEmail,
            password: wrongPassword,
          });
        }

        // 5th attempt should trigger lockout
        const response = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: wrongPassword,
        });

        expect(response.status).toBe(403);
        expect(response.data.error.code).toBe("ACCOUNT_LOCKED");
        expect(response.data.error.lockoutMinutesRemaining).toBe(30);
        expect(response.data.error.message).toContain("too many failed login attempts");

        // Verify lockout in database
        const container = getContainer();
        const query = container.resolve("query");
        const customers = await query.graph({
          entity: "customer",
          fields: ["failed_login_count", "locked_until"],
          filters: { email: testEmail },
        });

        const customer = customers.data[0];
        expect(customer.failed_login_count).toBe(5);
        expect(customer.locked_until).not.toBeNull();

        // Verify locked_until is approximately 30 minutes in the future
        const lockedUntil = new Date(customer.locked_until);
        const expectedUnlock = new Date(Date.now() + 30 * 60 * 1000);
        const timeDiff = Math.abs(lockedUntil.getTime() - expectedUnlock.getTime());
        expect(timeDiff).toBeLessThan(5000); // Within 5 seconds
      });

      /**
       * Test 3: Reject login attempts while locked
       * 
       * While account is locked, even correct password should be rejected.
       * This prevents attackers from continuing to try passwords.
       */
      it("should reject login attempts while account is locked", async () => {
        // Lock the account
        for (let i = 0; i < 5; i++) {
          await api.post("/auth/customer/emailpass", {
            email: testEmail,
            password: wrongPassword,
          });
        }

        // Try with correct password - should still be rejected
        const response = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: testPassword,
        });

        expect(response.status).toBe(403);
        expect(response.data.error.code).toBe("ACCOUNT_LOCKED");
      });

      /**
       * Test 4: Reset counter on successful login
       * 
       * When a user successfully logs in, the system should:
       * - Reset failed_login_count to 0
       * - Clear locked_until
       * - Update last_login_at
       * 
       * This ensures legitimate users don't get locked out after
       * a few typos followed by a successful login.
       */
      it("should reset failed_login_count on successful login", async () => {
        // Make 3 failed attempts
        for (let i = 0; i < 3; i++) {
          await api.post("/auth/customer/emailpass", {
            email: testEmail,
            password: wrongPassword,
          });
        }

        // Verify counter is at 3
        const container = getContainer();
        const query = container.resolve("query");
        let customers = await query.graph({
          entity: "customer",
          fields: ["failed_login_count"],
          filters: { email: testEmail },
        });
        expect(customers.data[0].failed_login_count).toBe(3);

        // Successful login
        const response = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: testPassword,
        });

        expect(response.status).toBe(200);

        // Verify counter is reset to 0
        customers = await query.graph({
          entity: "customer",
          fields: ["failed_login_count", "last_login_at"],
          filters: { email: testEmail },
        });

        expect(customers.data[0].failed_login_count).toBe(0);
        expect(customers.data[0].last_login_at).not.toBeNull();
      });

      /**
       * Test 5: Automatic unlock after lockout expires
       * 
       * After 30 minutes, the account should automatically unlock.
       * The user should be able to login again.
       * 
       * Note: We can't wait 30 minutes in a test, so we'll manually
       * set locked_until to a past time to simulate expiration.
       */
      it("should automatically unlock account after lockout expires", async () => {
        // Lock the account
        for (let i = 0; i < 5; i++) {
          await api.post("/auth/customer/emailpass", {
            email: testEmail,
            password: wrongPassword,
          });
        }

        // Manually set locked_until to past time (simulate 30 minutes passing)
        const container = getContainer();
        const manager = container.resolve("manager");
        const query = container.resolve("query");
        
        const customers = await query.graph({
          entity: "customer",
          fields: ["id"],
          filters: { email: testEmail },
        });

        await manager.update("customer", customers.data[0].id, {
          locked_until: new Date(Date.now() - 1000), // 1 second ago
        });

        // Try to login - should succeed and auto-unlock
        const response = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: testPassword,
        });

        expect(response.status).toBe(200);

        // Verify account is unlocked
        const updatedCustomers = await query.graph({
          entity: "customer",
          fields: ["failed_login_count", "locked_until"],
          filters: { email: testEmail },
        });

        expect(updatedCustomers.data[0].failed_login_count).toBe(0);
        expect(updatedCustomers.data[0].locked_until).toBeNull();
      });

      /**
       * Test 6: Lockout duration decreases over time
       * 
       * If a user tries to login while locked, the error message should
       * show the remaining time, which decreases as time passes.
       */
      it("should show decreasing lockout time remaining", async () => {
        // Lock the account
        for (let i = 0; i < 5; i++) {
          await api.post("/auth/customer/emailpass", {
            email: testEmail,
            password: wrongPassword,
          });
        }

        // Manually set locked_until to 10 minutes from now
        const container = getContainer();
        const manager = container.resolve("manager");
        const query = container.resolve("query");
        
        const customers = await query.graph({
          entity: "customer",
          fields: ["id"],
          filters: { email: testEmail },
        });

        await manager.update("customer", customers.data[0].id, {
          locked_until: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        });

        // Try to login
        const response = await api.post("/auth/customer/emailpass", {
          email: testEmail,
          password: testPassword,
        });

        expect(response.status).toBe(403);
        expect(response.data.error.code).toBe("ACCOUNT_LOCKED");
        expect(response.data.error.lockoutMinutesRemaining).toBe(10);
      });
    });
  },
});
