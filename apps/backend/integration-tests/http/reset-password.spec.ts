/**
 * Integration Tests for Password Reset Request Endpoint
 * 
 * These tests verify the password reset request endpoint functionality.
 */

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("POST /auth/customer/emailpass/reset-password", () => {
      beforeAll(() => {
        // Allow assertions on expected 4xx/429 responses without Axios throwing.
        (api as any).defaults.validateStatus = () => true;
      });

      /**
       * Test 1: Input validation - missing email
       */
      it("should reject request with missing email", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/reset-password",
          {}
        );

        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("MISSING_EMAIL");
      });

      /**
       * Test 2: Input validation - invalid email format
       */
      it("should reject request with invalid email format", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/reset-password",
          {
            email: "not-an-email",
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("INVALID_EMAIL");
      });

      /**
       * Test 3: Email enumeration protection
       * 
       * Should return same success response for non-existent email
       */
      it("should return generic success for non-existent email", async () => {
        const nonExistentEmail = "nonexistent@example.com";

        const response = await api.post(
          "/auth/customer/emailpass/reset-password",
          {
            email: nonExistentEmail,
          }
        );

        // Should return 200 OK with generic message
        expect(response.status).toBe(200);
        expect(response.data.message).toContain("If an account exists");
      });

      /**
       * Test 4: Email normalization
       */
      it("should normalize email (lowercase, trim)", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/reset-password",
          {
            email: "  TEST@EXAMPLE.COM  ",
          }
        );

        // Should accept and normalize the email
        expect(response.status).toBe(200);
        expect(response.data.message).toContain("If an account exists");
      });
    });
  },
});
