/**
 * Common Passwords List
 * 
 * This is a curated list of the most commonly used passwords.
 * We block these to prevent users from choosing easily guessable passwords.
 * 
 * Why block common passwords?
 * - Attackers use "dictionary attacks" - trying common passwords first
 * - These passwords are cracked in seconds
 * - Even if they meet length/complexity requirements, they're still weak
 * 
 * Source: Compiled from various breach databases and security research
 * (SplashData, NordPass, NCSC, Have I Been Pwned)
 * 
 * Note: In production, you'd load a larger list (10,000+) from a file
 * For this implementation, we're using a smaller representative sample
 */

export const COMMON_PASSWORDS = new Set([
  // Top 10 most common passwords (never use these!)
  'password',
  '123456',
  '123456789',
  '12345678',
  '12345',
  '1234567',
  'password1',
  '123123',
  '1234567890',
  'qwerty',
  
  // Common patterns
  'abc123',
  'password123',
  'qwerty123',
  'admin',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  
  // Keyboard patterns
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1qaz2wsx',
  'qazwsx',
  
  // Common words
  'football',
  'baseball',
  'basketball',
  'soccer',
  'iloveyou',
  'princess',
  'starwars',
  'superman',
  'batman',
  
  // Variations with numbers
  'password1',
  'password12',
  'password123',
  'admin123',
  'welcome123',
  'qwerty1',
  'abc123456',
  
  // Common substitutions (l33t speak)
  'p@ssw0rd',
  'p@ssword',
  'passw0rd',
  'pa$$word',
  'pa$$w0rd',
  
  // Years and dates
  '2024',
  '2023',
  '2022',
  '2021',
  '2020',
  
  // Simple sequences
  'abcdef',
  'abcdefg',
  'abcdefgh',
  '111111',
  '000000',
  '123321',
  '654321',
]);

/**
 * Check if a password is in the common passwords list
 * 
 * We check case-insensitively because:
 * - "Password" is just as weak as "password"
 * - Attackers try common passwords with various capitalizations
 * 
 * @param password - The password to check
 * @returns true if the password is common (and should be rejected)
 */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
