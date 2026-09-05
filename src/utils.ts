import crypto from 'crypto';
import { ValidationError } from './errors';

/**
 * Validates that all required fields exist and are non-empty strings/numbers in the given object.
 */
export function validateRequired(
  data: Record<string, unknown>,
  requiredFields: string[],
  contextName: string
): void {
  const missing: string[] = [];

  for (const field of requiredFields) {
    const value = data[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new ValidationError(
      `[${contextName}] Missing required field(s): ${missing.join(', ')}`,
      missing
    );
  }
}

/**
 * Generates an HMAC-SHA256 Base64-encoded signature for eSewa.
 */
export function generateHmacSha256(message: string, secretKey: string): string {
  if (!secretKey) {
    throw new ValidationError('Secret key is required to generate signature');
  }
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

/**
 * Timing-safe string comparison to prevent timing attacks during signature verification.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Strips trailing slashes from URLs.
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Converts a number or string to a string with clean formatting.
 */
export function formatAmount(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) {
    throw new ValidationError(`Invalid amount value: ${amount}`);
  }
  // If amount is a whole number, format as string or preserve decimal precision if present
  return String(num);
}
