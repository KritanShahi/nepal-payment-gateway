import NepalPaymentGateway, {
  Esewa,
  Khalti,
  esewa,
  khalti,
  initiateEsewaPayment,
  verifyEsewaPayment,
  initiateKhaltiPayment,
  verifyKhaltiPayment,
  ValidationError,
  EsewaError,
  KhaltiError,
  NepalPaymentGatewayError,
} from '../src/index';
import {
  generateHmacSha256,
  timingSafeEqual,
  formatAmount,
  normalizeUrl,
  validateRequired,
} from '../src/utils';

describe('Unified NepalPaymentGateway Module', () => {
  it('should instantiate NepalPaymentGateway with both sub-gateways and default flags', () => {
    const gateway = new NepalPaymentGateway({
      isTest: true,
      esewa: {
        productCode: 'EPAYTEST',
      },
      khalti: {
        secretKey: 'mock_key',
      },
    });

    expect(gateway).toBeInstanceOf(NepalPaymentGateway);
    expect(gateway.esewa).toBeInstanceOf(Esewa);
    expect(gateway.khalti).toBeInstanceOf(Khalti);

    // Empty config should also instantiate properly
    const defaultGateway = new NepalPaymentGateway();
    expect(defaultGateway.esewa).toBeInstanceOf(Esewa);
    expect(defaultGateway.khalti).toBeInstanceOf(Khalti);
  });

  it('should export standalone functions and sub-modules', () => {
    expect(typeof initiateEsewaPayment).toBe('function');
    expect(typeof verifyEsewaPayment).toBe('function');
    expect(typeof initiateKhaltiPayment).toBe('function');
    expect(typeof verifyKhaltiPayment).toBe('function');

    expect(esewa).toBeDefined();
    expect(typeof esewa.initiatePayment).toBe('function');
    expect(khalti).toBeDefined();
    expect(typeof khalti.initiatePayment).toBe('function');
  });

  it('should export all error classes', () => {
    expect(NepalPaymentGatewayError).toBeDefined();
    expect(ValidationError).toBeDefined();
    expect(EsewaError).toBeDefined();
    expect(KhaltiError).toBeDefined();

    const valErr = new ValidationError('Missing field');
    expect(valErr).toBeInstanceOf(NepalPaymentGatewayError);
    expect(valErr.name).toBe('ValidationError');

    const esewaErr = new EsewaError('Esewa error', 400);
    expect(esewaErr.statusCode).toBe(400);

    const khaltiErr = new KhaltiError('Khalti error', 401);
    expect(khaltiErr.statusCode).toBe(401);
  });

  describe('Utils Module', () => {
    it('should correctly run timingSafeEqual for equal and unequal lengths', () => {
      expect(timingSafeEqual('hello', 'hello')).toBe(true);
      expect(timingSafeEqual('hello', 'world')).toBe(false);
      expect(timingSafeEqual('short', 'much longer string')).toBe(false);
    });

    it('should validateRequired throw for missing/empty values', () => {
      expect(() => {
        validateRequired({ a: '   ', b: 1 }, ['a', 'b'], 'TestContext');
      }).toThrow(ValidationError);

      expect(() => {
        validateRequired({ a: null }, ['a'], 'TestContext');
      }).toThrow(ValidationError);
    });

    it('should throw when generateHmacSha256 called with empty secret', () => {
      expect(() => generateHmacSha256('msg', '')).toThrow(ValidationError);
    });

    it('should formatAmount properly and throw on invalid amount', () => {
      expect(formatAmount(100)).toBe('100');
      expect(formatAmount('250.5')).toBe('250.5');
      expect(() => formatAmount('invalid_number')).toThrow(ValidationError);
    });

    it('should normalize URLs by removing trailing slashes', () => {
      expect(normalizeUrl('https://example.com/api///')).toBe('https://example.com/api');
    });
  });
});
