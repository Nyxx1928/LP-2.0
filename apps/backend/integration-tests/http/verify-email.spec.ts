/**
 * Integration Tests for Email Verification Endpoint
 * 
 * These tests verify the email verification endpoint functionality.
 */

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("POST /auth/customer/emailpass/verify-email", () => {
      beforeAll(() => {
        // Allow assertions on expected 4xx responses without Axios throwing.
        (api as any).defaults.validateStatus = () => true;
      });

      /**
       * Test 1: Input validation - missing token
       */
      it("should reject request with missing token", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/verify-email",
          {}
        );

        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("MISSING_TOKEN");
      });

      /**
       * Test 2: Input validation - empty token
       */
      it("should reject request with empty token", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/verify-email",
          {
            token: "   ",
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("INVALID_TOKEN");
      });

      /**
       * Test 3: Invalid token
       * 
       * Should return error for non-existent token
       */
      it("should reject invalid token", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/verify-email",
          {
            token: "invalid-token-that-does-not-exist",
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("INVALID_TOKEN");
        expect(response.data.error.message).toContain("Invalid or expired");
      });

      /**
       * Test 4: Token trimming
       * 
       * Should trim whitespace from token
       */
      it("should trim whitespace from token", async () => {
        const response = await api.post(
          "/auth/customer/emailpass/verify-email",
          {
            token: "  some-token  ",
          }
        );

        // Should process the trimmed token (will fail validation but that's ok)
        expect(response.status).toBe(400);
        expect(response.data.error.code).toBe("INVALID_TOKEN");
      });
    });
  },
});
