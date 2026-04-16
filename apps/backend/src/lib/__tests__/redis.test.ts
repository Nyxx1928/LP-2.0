/**
 * Redis Connection Manager Tests
 * 
 * These tests verify that our Redis connection manager works correctly.
 * 
 * Testing Strategy:
 * - Unit tests for connection logic
 * - Health check verification
 * - Error handling
 */

import { redisManager } from '../redis';

describe('RedisManager', () => {
  // Clean up after all tests
  afterAll(async () => {
    await redisManager.disconnect();
  });

  describe('getClient', () => {
    it('should successfully connect to Redis', async () => {
      // Arrange & Act: Get the Redis client
      const client = await redisManager.getClient();

      // Assert: Client should be connected
      expect(client).toBeDefined();
      expect(client.isOpen).toBe(true);
    });

    it('should return the same client on multiple calls (singleton)', async () => {
      // Arrange & Act: Get client twice
      const client1 = await redisManager.getClient();
      const client2 = await redisManager.getClient();

      // Assert: Should be the exact same instance
      expect(client1).toBe(client2);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis is healthy', async () => {
      // Arrange & Act: Run health check
      const isHealthy = await redisManager.healthCheck();

      // Assert: Should be healthy
      expect(isHealthy).toBe(true);
    });

    it('should successfully ping Redis', async () => {
      // Arrange: Get client
      const client = await redisManager.getClient();

      // Act: Send PING command
      const response = await client.ping();

      // Assert: Should receive PONG
      expect(response).toBe('PONG');
    });
  });

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      // Arrange: Get client
      const client = await redisManager.getClient();
      const testKey = 'test:key';
      const testValue = 'test-value';

      // Act: Set a value
      await client.set(testKey, testValue);
      
      // Get the value back
      const retrievedValue = await client.get(testKey);

      // Assert: Should match what we set
      expect(retrievedValue).toBe(testValue);

      // Cleanup: Delete the test key
      await client.del(testKey);
    });

    it('should set a value with expiration', async () => {
      // Arrange: Get client
      const client = await redisManager.getClient();
      const testKey = 'test:expiring-key';
      const testValue = 'expires-soon';

      // Act: Set a value that expires in 1 second
      await client.set(testKey, testValue, { EX: 1 });

      // Immediately get the value - should exist
      const immediateValue = await client.get(testKey);
      expect(immediateValue).toBe(testValue);

      // Wait 1.5 seconds for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Get the value again - should be null (expired)
      const expiredValue = await client.get(testKey);
      expect(expiredValue).toBeNull();
    });
  });
});
