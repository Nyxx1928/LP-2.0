/**
 * Redis Connection Manager
 * 
 * This module provides a centralized Redis client with connection pooling
 * and health checking capabilities.
 * 
 * Key Concepts:
 * - Singleton Pattern: We create only ONE Redis client for the entire app
 * - Connection Pooling: Redis client internally manages multiple connections
 * - Lazy Connection: We don't connect until the first use
 * - Health Checks: We can verify Redis is working before using it
 */

import { createClient, RedisClientType } from 'redis';

/**
 * RedisManager class - Manages our Redis connection
 * 
 * Why a class? It encapsulates (bundles together) all Redis-related logic
 * and maintains state (the connection) in one place.
 */
class RedisManager {
  // The actual Redis client - starts as null until we connect
  private client: RedisClientType | null = null;
  
  // Track if we're currently connecting (prevents duplicate connections)
  private connecting: boolean = false;

  /**
   * Get or create the Redis client
   * 
   * This is called "lazy initialization" - we only create the connection
   * when someone actually needs it, not when the app starts.
   * 
   * Why? If Redis is down at startup, the app can still start and retry later.
   */
  async getClient(): Promise<RedisClientType> {
    // If we already have a connected client, return it immediately
    if (this.client && this.client.isOpen) {
      return this.client;
    }

    // If we're already connecting, wait for that to finish
    if (this.connecting) {
      // Poll every 100ms until connection is ready
      while (this.connecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.client && this.client.isOpen) {
        return this.client;
      }
    }

    // Start connecting
    this.connecting = true;

    try {
      // Get Redis URL from environment variable
      // Default to localhost if not set (for development)
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      // Create the Redis client with configuration
      this.client = createClient({
        url: redisUrl,
        
        // Socket configuration for connection management
        socket: {
          // Reconnect if connection drops
          reconnectStrategy: (retries) => {
            // Exponential backoff: wait longer between each retry
            // 1st retry: 50ms, 2nd: 100ms, 3rd: 200ms, etc.
            // Max wait: 3 seconds
            const delay = Math.min(retries * 50, 3000);
            console.log(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
          },
          
          // Timeout for connection attempts (10 seconds)
          connectTimeout: 10000,
        },
      });

      // Set up error handler - log errors but don't crash the app
      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      // Set up connection event handlers for monitoring
      this.client.on('connect', () => {
        console.log('Redis: Connection established');
      });

      this.client.on('ready', () => {
        console.log('Redis: Client ready to use');
      });

      this.client.on('reconnecting', () => {
        console.log('Redis: Reconnecting...');
      });

      // Actually connect to Redis
      await this.client.connect();

      console.log('Redis: Successfully connected');
      
      return this.client;
    } catch (error) {
      console.error('Redis: Failed to connect:', error);
      this.client = null;
      throw error;
    } finally {
      // Always reset the connecting flag
      this.connecting = false;
    }
  }

  /**
   * Health check - verify Redis is working
   * 
   * This is useful for:
   * - Startup checks: Is Redis available before we start the server?
   * - Health endpoints: Can we tell monitoring systems if Redis is healthy?
   * - Debugging: Quick way to test if Redis is the problem
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      
      // PING command: Redis responds with "PONG" if it's working
      // This is the simplest way to test if Redis is alive
      const response = await client.ping();
      
      return response === 'PONG';
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Gracefully close the Redis connection
   * 
   * Call this when shutting down the application to:
   * - Close connections cleanly
   * - Prevent "connection refused" errors in logs
   * - Allow Redis to clean up resources
   */
  async disconnect(): Promise<void> {
    if (this.client && this.client.isOpen) {
      await this.client.quit();
      this.client = null;
      console.log('Redis: Disconnected');
    }
  }
}

// Export a single instance (Singleton pattern)
// Everyone in the app uses the SAME Redis connection
export const redisManager = new RedisManager();

// Also export the type for TypeScript users
export type { RedisClientType };
