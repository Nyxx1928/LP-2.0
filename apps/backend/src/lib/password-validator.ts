/**
 * Password Validator Service
 * 
 * This service validates password strength and enforces security requirements.
 * 
 * Why validate passwords?
 * - Prevent weak passwords that are easily cracked
 * - Protect users from themselves (many users choose weak passwords)
 * - Meet security compliance requirements (PCI-DSS, NIST, etc.)
 * 
 * Validation Rules:
 * 1. Minimum 12 characters (NIST recommendation)
 * 2. At least one uppercase letter (A-Z)
 * 3. At least one lowercase letter (a-z)
 * 4. At least one number (0-9)
 * 5. At least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)
 * 6. Not in common password list
 * 7. Doesn't contain user's email address
 * 
 * Password Strength Calculation:
 * We calculate entropy (randomness) based on:
 * - Length (longer = more entropy)
 * - Character diversity (more types = more entropy)
 * - Patterns (repeated characters, sequences reduce entropy)
 */

import { isCommonPassword } from './common-passwords';

/**
 * Password validation result
 * 
 * This interface defines what we return after validating a password.
 * It tells the caller:
 * - Is the password valid?
 * - If not, what's wrong with it?
 * - How strong is it?
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
  score: number; // 0-100
}

/**
 * Password requirements configuration
 * 
 * This makes our validator flexible - we can change requirements
 * without rewriting the validation logic.
 */
export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

/**
 * Default password requirements
 * 
 * These follow industry best practices:
 * - NIST SP 800-63B (US government standard)
 * - OWASP (Open Web Application Security Project)
 * - PCI-DSS (Payment Card Industry)
 */
const DEFAULT_REQUIREMENTS: PasswordRequirements = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

/**
 * PasswordValidator class
 * 
 * Why a class instead of just functions?
 * - Encapsulation: Bundle related functionality together
 * - State: Store requirements configuration
 * - Testability: Easy to mock and test
 * - Reusability: Create multiple validators with different requirements
 */
export class PasswordValidator {
  private requirements: PasswordRequirements;

  /**
   * Constructor - initialize the validator with requirements
   * 
   * @param requirements - Optional custom requirements (uses defaults if not provided)
   */
  constructor(requirements: Partial<PasswordRequirements> = {}) {
    // Merge custom requirements with defaults
    // This allows partial overrides: new PasswordValidator({ minLength: 16 })
    this.requirements = { ...DEFAULT_REQUIREMENTS, ...requirements };
  }

  /**
   * Validate a password against all requirements
   * 
   * This is the main method - it checks everything and returns a complete result.
   * 
   * @param password - The password to validate
   * @param email - Optional email to check if password contains it
   * @returns Validation result with errors and strength score
   */
  validate(password: string, email?: string): PasswordValidationResult {
    const errors: string[] = [];

    // Check each requirement and collect errors
    // We check ALL requirements even if one fails, so users see all issues at once

    // 1. Length requirement
    if (password.length < this.requirements.minLength) {
      errors.push(
        `Password must be at least ${this.requirements.minLength} characters long`
      );
    }

    // 2. Uppercase requirement
    if (this.requirements.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // 3. Lowercase requirement
    if (this.requirements.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // 4. Number requirement
    if (this.requirements.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // 5. Special character requirement
    // Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?
    if (
      this.requirements.requireSpecialChars &&
      !/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)
    ) {
      errors.push('Password must contain at least one special character');
    }

    // 6. Common password check
    if (isCommonPassword(password)) {
      errors.push(
        'This password is too common. Please choose a more unique password'
      );
    }

    // 7. Email substring check (if email provided)
    if (email && this.containsEmail(password, email)) {
      errors.push('Password cannot contain your email address');
    }

    // Calculate strength score
    const score = this.calculateStrength(password);
    const strength = this.scoreToStrength(score);

    return {
      valid: errors.length === 0,
      errors,
      strength,
      score,
    };
  }

  /**
   * Check if password contains the email address (or parts of it)
   * 
   * Why check this?
   * - Email addresses are often public or easily guessable
   * - Using your email in your password makes it much weaker
   * 
   * We check:
   * - Full email (case-insensitive)
   * - Local part (before @)
   * - Domain part (after @, without TLD)
   * 
   * @param password - The password to check
   * @param email - The email address
   * @returns true if password contains email or parts of it
   */
  private containsEmail(password: string, email: string): boolean {
    const lowerPassword = password.toLowerCase();
    const lowerEmail = email.toLowerCase();

    // Check full email
    if (lowerPassword.includes(lowerEmail)) {
      return true;
    }

    // Extract local part (before @)
    const localPart = lowerEmail.split('@')[0];
    if (localPart && localPart.length >= 3 && lowerPassword.includes(localPart)) {
      return true;
    }

    // Extract domain without TLD (e.g., "gmail" from "gmail.com")
    const domain = lowerEmail.split('@')[1]?.split('.')[0];
    if (domain && domain.length >= 3 && lowerPassword.includes(domain)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate password strength score (0-100)
   * 
   * This uses a simplified entropy calculation:
   * Entropy = log2(possible_characters ^ password_length)
   * 
   * Higher entropy = harder to crack
   * 
   * Factors that increase score:
   * - Length (most important!)
   * - Character diversity (uppercase, lowercase, numbers, symbols)
   * - Lack of patterns (no repeated characters, no sequences)
   * 
   * Factors that decrease score:
   * - Repeated characters (aaa, 111)
   * - Sequential characters (abc, 123)
   * - Common patterns (qwerty, asdf)
   * 
   * @param password - The password to score
   * @returns Score from 0-100
   */
  calculateStrength(password: string): number {
    let score = 0;

    // Base score from length (0-40 points)
    // Length is the most important factor!
    // 12 chars = 20 points, 16 chars = 30 points, 20+ chars = 40 points
    const lengthScore = Math.min(40, (password.length / 20) * 40);
    score += lengthScore;

    // Character diversity (0-40 points, 10 per type)
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumbers = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);

    if (hasLowercase) score += 10;
    if (hasUppercase) score += 10;
    if (hasNumbers) score += 10;
    if (hasSpecial) score += 10;

    // Bonus for using multiple character types together (0-10 points)
    const typesUsed = [hasLowercase, hasUppercase, hasNumbers, hasSpecial].filter(
      Boolean
    ).length;
    if (typesUsed >= 3) score += 5;
    if (typesUsed === 4) score += 5;

    // Penalty for repeated characters (-10 points)
    // e.g., "aaa", "111", "!!!"
    if (/(.)\1{2,}/.test(password)) {
      score -= 10;
    }

    // Penalty for sequential characters (-10 points)
    // e.g., "abc", "123", "xyz"
    if (this.hasSequentialChars(password)) {
      score -= 10;
    }

    // Penalty for common patterns (-10 points)
    // e.g., "qwerty", "asdf", "1234"
    if (this.hasCommonPattern(password)) {
      score -= 10;
    }

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check for sequential characters
   * 
   * Sequential characters are predictable and reduce password strength.
   * Examples: abc, 123, xyz, 789
   * 
   * @param password - The password to check
   * @returns true if password contains 3+ sequential characters
   */
  private hasSequentialChars(password: string): boolean {
    const lower = password.toLowerCase();

    // Check for 3+ sequential letters or numbers
    for (let i = 0; i < lower.length - 2; i++) {
      const char1 = lower.charCodeAt(i);
      const char2 = lower.charCodeAt(i + 1);
      const char3 = lower.charCodeAt(i + 2);

      // Check if characters are sequential (e.g., a=97, b=98, c=99)
      if (char2 === char1 + 1 && char3 === char2 + 1) {
        return true;
      }

      // Also check reverse sequential (e.g., cba, 321)
      if (char2 === char1 - 1 && char3 === char2 - 1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for common keyboard patterns
   * 
   * Keyboard patterns are easy to type but easy to guess.
   * Examples: qwerty, asdf, zxcv
   * 
   * @param password - The password to check
   * @returns true if password contains common keyboard patterns
   */
  private hasCommonPattern(password: string): boolean {
    const lower = password.toLowerCase();
    const patterns = [
      'qwerty',
      'asdf',
      'zxcv',
      'qwertyuiop',
      'asdfghjkl',
      'zxcvbnm',
      '1234',
      '4321',
    ];

    return patterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Convert numeric score to strength label
   * 
   * This gives users a simple, understandable strength indicator.
   * 
   * Score ranges:
   * - 0-40: Weak (red) - Don't use this password!
   * - 41-70: Medium (yellow) - Acceptable but could be better
   * - 71-100: Strong (green) - Good password!
   * 
   * @param score - Numeric score (0-100)
   * @returns Strength label
   */
  private scoreToStrength(score: number): 'weak' | 'medium' | 'strong' {
    if (score <= 40) return 'weak';
    if (score <= 70) return 'medium';
    return 'strong';
  }
}

/**
 * Create a default password validator instance
 * 
 * This is a convenience export for common usage.
 * Most of the time, you'll use this instead of creating your own instance.
 */
export const passwordValidator = new PasswordValidator();
