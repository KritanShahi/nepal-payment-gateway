/**
 * Custom Error Classes for Nepal Payment Gateway SDK
 */

export class NepalPaymentGatewayError extends Error {
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'NepalPaymentGatewayError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends NepalPaymentGatewayError {
  public readonly missingFields?: string[];

  constructor(message: string, missingFields?: string[]) {
    super(message, 'VALIDATION_ERROR', { missingFields });
    this.name = 'ValidationError';
    this.missingFields = missingFields;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EsewaError extends NepalPaymentGatewayError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message, 'ESEWA_ERROR', details);
    this.name = 'EsewaError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class KhaltiError extends NepalPaymentGatewayError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message, 'KHALTI_ERROR', details);
    this.name = 'KhaltiError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
