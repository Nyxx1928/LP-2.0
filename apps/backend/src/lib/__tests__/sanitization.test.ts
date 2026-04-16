import {
  sanitizeString,
  sanitizeEmail,
  sanitizeUsername,
  sanitizePhoneNumber,
  sanitizeUrl,
  sanitizeNumber,
  sanitizeObject,
  sanitizeHtml,
  sanitizeJson,
  RateLimiter,
} from '../sanitization';

describe('Input Sanitization', () => {
  describe('sanitizeString', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
      expect(sanitizeString('Hello <b>World</b>')).toBe('Hello bWorld/b');
    });

    it('should escape quotes', () => {
      expect(sanitizeString('Hello "World"')).toBe('Hello &quot;World&quot;');
      expect(sanitizeString("Hello 'World'")).toBe('Hello &#x27;World&#x27;');
    });

    it('should trim whitespace', () => {
      expect(sanitizeString('  Hello World  ')).toBe('Hello World');
    });

    it('should limit length', () => {
      const longString = 'a'.repeat(2000);
      expect(sanitizeString(longString).length).toBe(1000);
    });

    it('should handle non-string input', () => {
      expect(sanitizeString(123 as any)).toBe('');
      expect(sanitizeString(null as any)).toBe('');
    });
  });

  describe('sanitizeEmail', () => {
    it('should normalize valid emails', () => {
      expect(sanitizeEmail('Test@Example.COM')).toBe('test@example.com');
      expect(sanitizeEmail('  user@domain.com  ')).toBe('user@domain.com');
    });

    it('should reject invalid emails', () => {
      expect(() => sanitizeEmail('invalid')).toThrow('Invalid email format');
      expect(() => sanitizeEmail('test@')).toThrow('Invalid email format');
      expect(() => sanitizeEmail('@example.com')).toThrow('Invalid email format');
    });

    it('should handle non-string input', () => {
      expect(sanitizeEmail(123 as any)).toBe('');
    });
  });

  describe('sanitizeUsername', () => {
    it('should normalize valid usernames', () => {
      expect(sanitizeUsername('JohnDoe123')).toBe('johndoe123');
      expect(sanitizeUsername('user_name')).toBe('user_name');
      expect(sanitizeUsername('user-name')).toBe('user-name');
    });

    it('should reject invalid usernames', () => {
      expect(() => sanitizeUsername('ab')).toThrow('must be between 3 and 30 characters');
      expect(() => sanitizeUsername('a'.repeat(31))).toThrow('must be between 3 and 30 characters');
      expect(() => sanitizeUsername('user@name')).toThrow('can only contain letters');
      expect(() => sanitizeUsername('user name')).toThrow('can only contain letters');
    });
  });

  describe('sanitizePhoneNumber', () => {
    it('should remove non-numeric characters', () => {
      expect(sanitizePhoneNumber('+1 (555) 123-4567')).toBe('15551234567');
      expect(sanitizePhoneNumber('555.123.4567')).toBe('5551234567');
    });

    it('should reject invalid phone numbers', () => {
      expect(() => sanitizePhoneNumber('123')).toThrow('Invalid phone number length');
      expect(() => sanitizePhoneNumber('1'.repeat(20))).toThrow('Invalid phone number length');
    });
  });

  describe('sanitizeUrl', () => {
    it('should validate and normalize URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
      expect(sanitizeUrl('http://example.com/path')).toBe('http://example.com/path');
    });

    it('should reject invalid protocols', () => {
      expect(() => sanitizeUrl('javascript:alert(1)')).toThrow('Only HTTP and HTTPS URLs are allowed');
      expect(() => sanitizeUrl('ftp://example.com')).toThrow('Only HTTP and HTTPS URLs are allowed');
    });

    it('should reject malformed URLs', () => {
      expect(() => sanitizeUrl('not a url')).toThrow('Invalid URL format');
    });
  });

  describe('sanitizeNumber', () => {
    it('should parse valid numbers', () => {
      expect(sanitizeNumber('123')).toBe(123);
      expect(sanitizeNumber(456)).toBe(456);
      expect(sanitizeNumber('123.45')).toBe(123.45);
    });

    it('should enforce integer constraint', () => {
      expect(sanitizeNumber(123, { integer: true })).toBe(123);
      expect(() => sanitizeNumber(123.45, { integer: true })).toThrow('must be an integer');
    });

    it('should enforce min/max bounds', () => {
      expect(sanitizeNumber(50, { min: 0, max: 100 })).toBe(50);
      expect(() => sanitizeNumber(-1, { min: 0 })).toThrow('must be at least 0');
      expect(() => sanitizeNumber(101, { max: 100 })).toThrow('must be at most 100');
    });

    it('should reject invalid numbers', () => {
      expect(() => sanitizeNumber('abc')).toThrow('Invalid number');
      expect(() => sanitizeNumber(NaN)).toThrow('Invalid number');
      expect(() => sanitizeNumber(Infinity)).toThrow('Invalid number');
    });
  });

  describe('sanitizeObject', () => {
    it('should remove dangerous keys', () => {
      const obj = {
        name: 'John',
        __proto__: { admin: true },
        constructor: 'bad',
        prototype: 'bad',
      };
      const sanitized = sanitizeObject(obj);
      expect(sanitized).toEqual({ name: 'John' });
      expect(sanitized.__proto__).toBeUndefined();
    });

    it('should filter by allowed keys', () => {
      const obj = { name: 'John', age: 30, secret: 'hidden' };
      const sanitized = sanitizeObject(obj, ['name', 'age']);
      expect(sanitized).toEqual({ name: 'John', age: 30 });
    });

    it('should remove null/undefined values', () => {
      const obj = { name: 'John', age: null, email: undefined };
      const sanitized = sanitizeObject(obj);
      expect(sanitized).toEqual({ name: 'John' });
    });
  });

  describe('sanitizeHtml', () => {
    it('should remove script tags', () => {
      expect(sanitizeHtml('<p>Hello</p><script>alert(1)</script>')).toBe('<p>Hello</p>');
    });

    it('should remove event handlers', () => {
      expect(sanitizeHtml('<div onclick="alert(1)">Click</div>')).toBe('<div >Click</div>');
    });

    it('should remove javascript: protocol', () => {
      expect(sanitizeHtml('<a href="javascript:alert(1)">Link</a>')).toBe('<a href="alert(1)">Link</a>');
    });

    it('should remove iframes', () => {
      expect(sanitizeHtml('<p>Hello</p><iframe src="evil.com"></iframe>')).toBe('<p>Hello</p>frame src="evil.com">frame>');
    });
  });

  describe('sanitizeJson', () => {
    it('should parse valid JSON', () => {
      expect(sanitizeJson('{"name":"John"}')).toEqual({ name: 'John' });
      expect(sanitizeJson('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('should remove dangerous properties', () => {
      const json = '{"name":"John","__proto__":{"admin":true}}';
      const parsed = sanitizeJson(json);
      expect(parsed.__proto__).toBeUndefined();
    });

    it('should reject invalid JSON', () => {
      expect(() => sanitizeJson('not json')).toThrow('Invalid JSON format');
      expect(() => sanitizeJson('{invalid}')).toThrow('Invalid JSON format');
    });

    it('should reject non-string input', () => {
      expect(() => sanitizeJson(123 as any)).toThrow('Input must be a string');
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within limit', () => {
      const limiter = new RateLimiter(3, 1000);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(true);
    });

    it('should block requests exceeding limit', () => {
      const limiter = new RateLimiter(2, 1000);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(false);
    });

    it('should reset after window expires', async () => {
      const limiter = new RateLimiter(1, 100);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(false);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(limiter.check('user1')).toBe(true);
    });

    it('should track different identifiers separately', () => {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user2')).toBe(true);
      expect(limiter.check('user1')).toBe(false);
      expect(limiter.check('user2')).toBe(false);
    });

    it('should allow manual reset', () => {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.check('user1')).toBe(true);
      expect(limiter.check('user1')).toBe(false);
      
      limiter.reset('user1');
      expect(limiter.check('user1')).toBe(true);
    });
  });
});
