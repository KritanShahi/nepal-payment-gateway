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
 * Parses an amount that may arrive as a number or a string containing
 * thousands separators. eSewa is known to return callback amounts such as
 * "1,000.0", which naive parseFloat would truncate to 1.
 */
export function parseAmount(amount: number | string): number {
  const num = typeof amount === 'string' ? parseFloat(amount.replace(/,/g, '').trim()) : amount;
  if (typeof num !== 'number' || isNaN(num)) {
    throw new ValidationError(`Invalid amount value: ${amount}`);
  }
  return num;
}

/**
 * Converts a number or string amount to a clean string, tolerating
 * comma-formatted input (e.g. "1,000.0" -> "1000").
 */
export function formatAmount(amount: number | string): string {
  return String(parseAmount(amount));
}

/**
 * Converts an amount in paisa (integer, smallest currency unit) to an NPR string.
 * e.g. 150050 -> "1500.5"
 */
export function paisaToRupees(paisa: number): number {
  if (!Number.isInteger(paisa)) {
    throw new ValidationError(`Paisa amount must be an integer, got: ${paisa}`);
  }
  return paisa / 100;
}

/**
 * Converts an NPR amount to paisa (integer, smallest currency unit).
 * e.g. 1500.5 -> 150050
 */
export function rupeesToPaisa(rupees: number | string): number {
  const num = parseAmount(rupees);
  return Math.round(num * 100);
}

/**
 * Reads a boolean-ish environment variable ("false"/"0"/"no" -> false).
 */
export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

/**
 * Generates a short random alphanumeric suffix for transaction identifiers.
 */
export function randomSuffix(length = 6): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
