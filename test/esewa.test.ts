import crypto from 'crypto';
import {
  Esewa,
  ESEWA_PRODUCTION_BASE_URL,
  ESEWA_SANDBOX_BASE_URL,
  decodeCallbackData,
  generatePaymentFormHtml,
  initiatePayment,
  verifyPayment,
  verifySignature,
} from '../src/esewa';
import { EsewaError, ValidationError } from '../src/errors';

describe('eSewa Payment Gateway Module', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ESEWA_PRODUCT_CODE;
    delete process.env.ESEWA_SECRET_KEY;
    delete process.env.ESEWA_BASE_URL;
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with sandbox defaults', () => {
      const esewa = new Esewa({ isTest: true });
      expect(esewa).toBeInstanceOf(Esewa);
    });

    it('should use production URL when isTest is false', () => {
      const esewa = new Esewa({
        productCode: 'PROD_MERCHANT',
        secretKey: 'prod_secret',
        isTest: false,
      });

      const result = esewa.initiatePayment({
        amount: 500,
        transactionUuid: 'txn-prod',
        successUrl: 'https://example.com/success',
        failureUrl: 'https://example.com/failure',
      });

      expect(result.paymentUrl).toBe(`${ESEWA_PRODUCTION_BASE_URL}/api/epay/main/v2/form`);
    });

    it('should respect custom credentials and base URL', () => {
      const esewa = new Esewa({
        productCode: 'CUSTOM_MERCHANT',
        secretKey: 'custom_secret_key',
        isTest: false,
        baseUrl: 'https://custom-epay.example.com/',
      });

      const result = esewa.initiatePayment({
        amount: 500,
        transactionUuid: 'txn-12345',
        successUrl: 'https://example.com/success',
        failureUrl: 'https://example.com/failure',
      });

      expect(result.paymentUrl).toBe('https://custom-epay.example.com/api/epay/main/v2/form');
      expect(result.formFields.product_code).toBe('CUSTOM_MERCHANT');
    });

    it('should read from environment variables if not passed in config', () => {
      process.env.ESEWA_PRODUCT_CODE = 'ENV_PROD_CODE';
      process.env.ESEWA_SECRET_KEY = 'env_secret';
      process.env.ESEWA_BASE_URL = 'https://env-url.example.com';

      const esewa = new Esewa();
      const result = esewa.initiatePayment({
        amount: 250,
        transactionUuid: 'txn-env',
        successUrl: 'https://example.com/success',
        failureUrl: 'https://example.com/failure',
      });

      expect(result.formFields.product_code).toBe('ENV_PROD_CODE');
      expect(result.paymentUrl).toBe('https://env-url.example.com/api/epay/main/v2/form');
    });
  });

  describe('initiatePayment', () => {
    it('should generate valid form fields and HMAC-SHA256 signature', () => {
      const secretKey = '8gBm/:&EnhH.1/q';
      const esewa = new Esewa({
        productCode: 'EPAYTEST',
        secretKey,
        isTest: true,
      });

      const result = esewa.initiatePayment({
        amount: 100,
        taxAmount: 10,
        productServiceCharge: 5,
        productDeliveryCharge: 15,
        transactionUuid: 'TXN-998877',
        successUrl: 'https://myapp.com/payment/success',
        failureUrl: 'https://myapp.com/payment/failure',
      });

      expect(result.totalAmount).toBe('130');
      expect(result.formFields.amount).toBe('100');
      expect(result.formFields.tax_amount).toBe('10');
      expect(result.formFields.product_service_charge).toBe('5');
      expect(result.formFields.product_delivery_charge).toBe('15');
      expect(result.formFields.total_amount).toBe('130');
      expect(result.formFields.transaction_uuid).toBe('TXN-998877');
      expect(result.formFields.product_code).toBe('EPAYTEST');
      expect(result.formFields.signed_field_names).toBe('total_amount,transaction_uuid,product_code');

      // Verify signature
      const expectedMessage = 'total_amount=130,transaction_uuid=TXN-998877,product_code=EPAYTEST';
      const expectedSignature = crypto.createHmac('sha256', secretKey).update(expectedMessage).digest('base64');
      expect(result.signature).toBe(expectedSignature);
      expect(result.formFields.signature).toBe(expectedSignature);
      expect(result.paymentUrl).toBe(`${ESEWA_SANDBOX_BASE_URL}/api/epay/main/v2/form`);
      expect(result.formHtml).toContain('<form id="esewaPaymentForm"');
    });

    it('should throw ValidationError if required fields are missing', () => {
      const esewa = new Esewa({ productCode: '', secretKey: '' });
      expect(() => {
        // @ts-expect-error test missing fields
        esewa.initiatePayment({ amount: 100 });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError for non-positive amount or invalid amount string', () => {
      const esewa = new Esewa({ isTest: true });
      expect(() => {
        esewa.initiatePayment({
          amount: -50,
          transactionUuid: 'txn-neg',
          successUrl: 'https://example.com/success',
          failureUrl: 'https://example.com/failure',
        });
      }).toThrow(ValidationError);

      expect(() => {
        esewa.initiatePayment({
          amount: 'not-a-number',
          transactionUuid: 'txn-nan',
          successUrl: 'https://example.com/success',
          failureUrl: 'https://example.com/failure',
        });
      }).toThrow(ValidationError);
    });
  });

  describe('decodeCallbackData and verifySignature', () => {
    it('should decode base64 callback data correctly', () => {
      const rawData = {
        transaction_code: '000AWEO',
        status: 'COMPLETE',
        total_amount: '1000.0',
        transaction_uuid: '250610-162413',
        product_code: 'EPAYTEST',
        signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
        signature: 'TEST_SIG',
      };

      const base64Str = Buffer.from(JSON.stringify(rawData)).toString('base64');
      const decoded = decodeCallbackData(base64Str);

      expect(decoded.transaction_code).toBe('000AWEO');
      expect(decoded.status).toBe('COMPLETE');
      expect(decoded.total_amount).toBe('1000.0');
    });

    it('should throw ValidationError on invalid base64 data', () => {
      expect(() => decodeCallbackData('invalid!!!json')).toThrow(ValidationError);
      // @ts-expect-error test empty input
      expect(() => decodeCallbackData(null)).toThrow(ValidationError);
    });

    it('should verify signature of valid callback payload (both object and encoded string)', () => {
      const secretKey = '8gBm/:&EnhH.1/q';
      const esewa = new Esewa({ secretKey });

      const signedFieldNames = 'transaction_code,status,total_amount,transaction_uuid,product_code';
      const message = `transaction_code=000AWEO,status=COMPLETE,total_amount=100.0,transaction_uuid=TXN-1,product_code=EPAYTEST`;
      const validSig = crypto.createHmac('sha256', secretKey).update(message).digest('base64');

      const payload = {
        transaction_code: '000AWEO',
        status: 'COMPLETE',
        total_amount: '100.0',
        transaction_uuid: 'TXN-1',
        product_code: 'EPAYTEST',
        signed_field_names: signedFieldNames,
        signature: validSig,
      };

      expect(esewa.verifySignature(payload)).toBe(true);

      const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
      expect(esewa.verifySignature(base64Payload)).toBe(true);

      // Tampered payload
      const tamperedPayload = { ...payload, total_amount: '5000.0' };
      expect(esewa.verifySignature(tamperedPayload)).toBe(false);

      // Payload missing signature
      expect(esewa.verifySignature({ ...payload, signature: '' })).toBe(false);
    });

    it('should throw ValidationError if verifying signature without secretKey', () => {
      const esewa = new Esewa({ isTest: false, secretKey: '' });
      expect(() => {
        esewa.verifySignature({
          transaction_code: '1',
          status: 'COMPLETE',
          total_amount: '100',
          transaction_uuid: '1',
          product_code: 'EPAYTEST',
          signed_field_names: 'total_amount',
          signature: 'abc',
        });
      }).toThrow(ValidationError);
    });
  });

  describe('verifyPayment API', () => {
    it('should verify payment successfully when status is COMPLETE', async () => {
      const esewa = new Esewa({ isTest: true });

      const mockResponse = {
        product_code: 'EPAYTEST',
        transaction_uuid: 'TXN-SUCCESS-1',
        total_amount: 100.0,
        status: 'COMPLETE',
        ref_id: '0009988AA',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await esewa.verifyPayment({
        transactionUuid: 'TXN-SUCCESS-1',
        totalAmount: 100,
        productCode: 'EPAYTEST',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETE');
      expect(result.refId).toBe('0009988AA');
      expect(result.totalAmount).toBe('100');
    });

    it('should return success: false when status is not COMPLETE (e.g. PENDING or NOT_FOUND)', async () => {
      const esewa = new Esewa({ isTest: true });

      const mockResponse = {
        product_code: 'EPAYTEST',
        transaction_uuid: 'TXN-PENDING-1',
        total_amount: 100.0,
        status: 'PENDING',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await esewa.verifyPayment({
        transactionUuid: 'TXN-PENDING-1',
        totalAmount: 100,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
    });

    it('should throw EsewaError when API returns non-200 HTTP error (text response fallback)', async () => {
      const esewa = new Esewa({ isTest: true });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => 'Internal Server Error Text',
      } as unknown as Response);

      await expect(
        esewa.verifyPayment({
          transactionUuid: 'TXN-ERR-500',
          totalAmount: 100,
        })
      ).rejects.toThrow(EsewaError);
    });

    it('should wrap network exceptions into EsewaError', async () => {
      const esewa = new Esewa({ isTest: true });

      global.fetch = jest.fn().mockRejectedValue(new Error('DNS resolution failed'));

      await expect(
        esewa.verifyPayment({
          transactionUuid: 'TXN-NET-ERR',
          totalAmount: 100,
        })
      ).rejects.toThrow(EsewaError);
    });

    it('should work with standalone function exports', async () => {
      const result = initiatePayment({
        amount: 200,
        transactionUuid: 'TXN-STANDALONE',
        successUrl: 'https://example.com/s',
        failureUrl: 'https://example.com/f',
        productCode: 'EPAYTEST',
        secretKey: '8gBm/:&EnhH.1/q',
      });

      expect(result.totalAmount).toBe('200');

      const html = generatePaymentFormHtml(result.formFields, result.paymentUrl);
      expect(html).toContain('Redirecting to eSewa');

      const isSigValid = verifySignature(
        {
          product_code: 'EPAYTEST',
          transaction_uuid: 'TXN-1',
          total_amount: '100',
          signed_field_names: 'product_code,total_amount',
          signature: crypto.createHmac('sha256', '8gBm/:&EnhH.1/q').update('product_code=EPAYTEST,total_amount=100').digest('base64'),
          transaction_code: '0',
          status: 'COMPLETE',
        },
        '8gBm/:&EnhH.1/q'
      );
      expect(isSigValid).toBe(true);
    });
  });
});
