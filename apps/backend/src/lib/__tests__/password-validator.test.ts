/**
 * Password Validator Tests
 * 
 * These tests verify that our password validator correctly enforces
 * all security requirements and accurately calculates password strength.
 * 
 * Test Strategy:
 * - Test each requirement individually
 * - Test combinations of requirements
 * - Test edge cases (empty strings, very long passwords, unicode)
 * - Test strength calculation accuracy
 * - Test email substring detection
 */

import { PasswordValidator } from '../password-validator';

describe('PasswordValidator', () => {
  let validator: PasswordValidator;

  beforeEach(() => {
    // Create a fresh validator for each test
    validator = new PasswordValidator();
  });

  describe('Length Requirement', () => {
    it('should reject passwords shorter than 12 characters', () => {
      const result = validator.validate('Short1!');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must be at least 12 characters long'
      );
    });

    it('should accept passwords with exactly 12 characters', () => {
      const result = validator.validate('ValidPass1!@');
      
      // Should pass length requirement (may fail others)
      expect(result.errors).not.toContain(
        'Password must be at least 12 characters long'
      );
    });

    it('should accept passwords longer than 12 characters', () => {
      const result = validator.validate('VeryLongValidPassword123!@#');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Character Class Requirements', () => {
    it('should reject passwords without uppercase letters', () => {
      const result = validator.validate('lowercase123!@#');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter'
      );
    });

    it('should reject passwords without lowercase letters', () => {
      const result = validator.validate('UPPERCASE123!@#');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one lowercase letter'
      );
    });

    it('should reject passwords without numbers', () => {
      const result = validator.validate('NoNumbersHere!@#');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one number'
      );
    });

    it('should reject passwords without special characters', () => {
      const result = validator.validate('NoSpecialChars123');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one special character'
      );
    });

    it('should accept passwords with all character classes', () => {
      const result = validator.validate('ValidPassword123!');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Common Password Detection', () => {
    it('should reject common passwords', () => {
      const commonPasswords = [
        'password',
        '123456',
        'qwerty',
        'password123',
        'admin123',
      ];

      commonPasswords.forEach((password) => {
        const result = validator.validate(password);
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'This password is too common. Please choose a more unique password'
        );
      });
    });

    it('should reject common passwords regardless of case', () => {
      const result = validator.validate('PASSWORD');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'This password is too common. Please choose a more unique password'
      );
    });

    it('should accept uncommon passwords', () => {
      const result = validator.validate('UniquePassword123!@#');
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Email Substring Detection', () => {
    it('should reject passwords containing full email', () => {
      const result = validator.validate(
        'user@example.com123!',
        'user@example.com'
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password cannot contain your email address'
      );
    });

    it('should reject passwords containing email local part', () => {
      const result = validator.validate(
        'MyPasswordIsUser123!',
        'user@example.com'
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password cannot contain your email address'
      );
    });

    it('should reject passwords containing email domain', () => {
      const result = validator.validate(
        'MyPasswordIsExample123!',
        'user@example.com'
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password cannot contain your email address'
      );
    });

    it('should accept passwords not containing email parts', () => {
      const result = validator.validate(
        'CompletelyDifferent123!',
        'user@example.com'
      );
      
      expect(result.valid).toBe(true);
    });

    it('should be case-insensitive when checking email', () => {
      const result = validator.validate(
        'MyPasswordIsUSER123!',
        'user@example.com'
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password cannot contain your email address'
      );
    });
  });

  describe('Strength Calculation', () => {
    it('should rate short passwords as weak', () => {
      const result = validator.validate('Short1!');
      
      expect(result.strength).toBe('weak');
      expect(result.score).toBeLessThan(40);
    });

    it('should rate passwords with only lowercase as weak', () => {
      const result = validator.validate('onlylowercase');
      
      expect(result.strength).toBe('weak');
    });

    it('should rate passwords with good length and diversity as medium', () => {
      const result = validator.validate('GoodPassword123');
      
      expect(result.strength).toBe('medium');
      expect(result.score).toBeGreaterThan(40);
      expect(result.score).toBeLessThanOrEqual(70);
    });

    it('should rate long passwords with all character types as strong', () => {
      const result = validator.validate('VeryStrongPassword123!@#$%');
      
      expect(result.strength).toBe('strong');
      expect(result.score).toBeGreaterThan(70);
    });

    it('should penalize repeated characters', () => {
      const withRepeats = validator.validate('Passwordaaa123!');
      const withoutRepeats = validator.validate('PasswordAbc123!');
      
      expect(withRepeats.score).toBeLessThan(withoutRepeats.score);
    });

    it('should penalize sequential characters', () => {
      const withSequence = validator.validate('Passwordabc123!');
      const withoutSequence = validator.validate('PasswordXyZ123!');
      
      expect(withSequence.score).toBeLessThan(withoutSequence.score);
    });

    it('should penalize common keyboard patterns', () => {
      const withPattern = validator.validate('Passwordqwerty1!');
      const withoutPattern = validator.validate('PasswordRandom1!');
      
      expect(withPattern.score).toBeLessThan(withoutPattern.score);
    });
  });

  describe('Multiple Errors', () => {
    it('should return all validation errors at once', () => {
      const result = validator.validate('short');
      
      // Should fail multiple requirements
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain(
        'Password must be at least 12 characters long'
      );
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter'
      );
      expect(result.errors).toContain(
        'Password must contain at least one number'
      );
      expect(result.errors).toContain(
        'Password must contain at least one special character'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = validator.validate('');
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle very long passwords', () => {
      const longPassword = 'A'.repeat(100) + 'a1!';
      const result = validator.validate(longPassword);
      
      // Should be valid (meets all requirements)
      expect(result.valid).toBe(true);
      // Should have high strength score
      expect(result.strength).toBe('strong');
    });

    it('should handle unicode characters', () => {
      const result = validator.validate('Pässwörd123!@#');
      
      // Should validate (unicode counts as lowercase)
      expect(result.valid).toBe(true);
    });

    it('should handle passwords with only special characters', () => {
      const result = validator.validate('!@#$%^&*()_+');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter'
      );
      expect(result.errors).toContain(
        'Password must contain at least one lowercase letter'
      );
      expect(result.errors).toContain(
        'Password must contain at least one number'
      );
    });
  });

  describe('Custom Requirements', () => {
    it('should allow custom minimum length', () => {
      const customValidator = new PasswordValidator({ minLength: 16 });
      const result = customValidator.validate('ShortPassword1!');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must be at least 16 characters long'
      );
    });

    it('should allow disabling uppercase requirement', () => {
      const customValidator = new PasswordValidator({ requireUppercase: false });
      const result = customValidator.validate('lowercase123!@#');
      
      expect(result.valid).toBe(true);
    });

    it('should allow disabling special character requirement', () => {
      const customValidator = new PasswordValidator({
        requireSpecialChars: false,
      });
      const result = customValidator.validate('Password123abc');
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Real-World Password Examples', () => {
    it('should accept strong real-world passwords', () => {
      const strongPasswords = [
        'MyDog$Name1sMax!',
        'C0ffee&Sunshine2024',
        'Tr@vel!ng_Europe23',
        'B00k$helF_Lover!',
      ];

      strongPasswords.forEach((password) => {
        const result = validator.validate(password);
        expect(result.valid).toBe(true);
        expect(result.strength).toMatch(/medium|strong/);
      });
    });

    it('should reject weak real-world passwords', () => {
      const weakPasswords = [
        'password',
        'Password1',
        '12345678',
        'qwerty123',
      ];

      weakPasswords.forEach((password) => {
        const result = validator.validate(password);
        expect(result.valid).toBe(false);
      });
    });
  });
});
