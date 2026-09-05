import { Khalti, initiatePayment, verifyPayment, KHALTI_PRODUCTION_BASE_URL, KHALTI_SANDBOX_BASE_URL } from '../src/khalti';
import { KhaltiError, ValidationError } from '../src/errors';

describe('Khalti Payment Gateway Module', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.KHALTI_SECRET_KEY;
    delete process.env.KHALTI_BASE_URL;
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with provided config', () => {
      const khalti = new Khalti({
        secretKey: 'test_secret_key',
        isTest: true,
      });
      expect(khalti).toBeInstanceOf(Khalti);
    });

    it('should fallback to environment variables', () => {
      process.env.KHALTI_SECRET_KEY = 'env_khalti_secret';
      process.env.KHALTI_BASE_URL = 'https://env-khalti.example.com';
      const khalti = new Khalti();
      expect(khalti).toBeInstanceOf(Khalti);
    });

    it('should use production URL when isTest is false', async () => {
      const khalti = new Khalti({
        secretKey: 'live_key_xyz',
        isTest: false,
      });

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          pidx: 'PROD_PIDX_1',
          payment_url: 'https://pay.khalti.com/?pidx=PROD_PIDX_1',
        }),
      } as unknown as Response);
      global.fetch = fetchMock;

      await khalti.initiatePayment({
        returnUrl: 'https://example.com/callback',
        websiteUrl: 'https://example.com',
        amount: 5000,
        purchaseOrderId: 'PROD_ORD_1',
        purchaseOrderName: 'Prod Item',
      });

      expect(fetchMock.mock.calls[0][0]).toBe(`${KHALTI_PRODUCTION_BASE_URL}/epayment/initiate/`);
    });
  });

  describe('initiatePayment', () => {
    it('should call Khalti initiate endpoint with valid payload, amount breakdown, product details, and headers', async () => {
      const khalti = new Khalti({
        secretKey: 'mock_live_secret_key',
        isTest: true,
      });

      const mockResponse = {
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
        payment_url: 'https://test-pay.khalti.com/?pidx=HT6HuGPEacv2hwLQL8yA2L',
        expires_at: '2026-09-05T18:00:00Z',
        expires_in: 1800,
      };

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);
      global.fetch = fetchMock;

      const result = await khalti.initiatePayment({
        returnUrl: 'https://example.com/payment/callback',
        websiteUrl: 'https://example.com',
        amount: '1000',
        purchaseOrderId: 'ORDER-101',
        purchaseOrderName: 'Test Product Order',
        customerInfo: {
          name: 'Ram Bahadur',
          email: 'ram@example.com',
          phone: '9800000001',
        },
        amountBreakdown: [
          { label: 'Item 1', amount: 1000 },
        ],
        productDetails: [
          { identity: 'PROD-1', name: 'Product 1', total_price: 1000, quantity: 1, unit_price: 1000 },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${KHALTI_SANDBOX_BASE_URL}/epayment/initiate/`);
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Key mock_live_secret_key');

      const body = JSON.parse(options.body as string);
      expect(body.return_url).toBe('https://example.com/payment/callback');
      expect(body.amount).toBe(1000);
      expect(body.purchase_order_id).toBe('ORDER-101');
      expect(body.customer_info.name).toBe('Ram Bahadur');
      expect(body.amount_breakdown).toHaveLength(1);
      expect(body.product_details).toHaveLength(1);

      expect(result.pidx).toBe('HT6HuGPEacv2hwLQL8yA2L');
      expect(result.paymentUrl).toBe('https://test-pay.khalti.com/?pidx=HT6HuGPEacv2hwLQL8yA2L');
      expect(result.expiresIn).toBe(1800);
    });

    it('should throw ValidationError when required fields are missing', async () => {
      const khalti = new Khalti();
      await expect(
        // @ts-expect-error test missing fields
        khalti.initiatePayment({ amount: 1000 })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when amount is not a positive integer', async () => {
      const khalti = new Khalti({ secretKey: 'key123' });
      await expect(
        khalti.initiatePayment({
          returnUrl: 'https://example.com/callback',
          websiteUrl: 'https://example.com',
          amount: 0,
          purchaseOrderId: 'ORD-1',
          purchaseOrderName: 'Order',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        khalti.initiatePayment({
          returnUrl: 'https://example.com/callback',
          websiteUrl: 'https://example.com',
          amount: 'abc',
          purchaseOrderId: 'ORD-1',
          purchaseOrderName: 'Order',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw KhaltiError on API failure (e.g. 400 Bad Request / text fallback)', async () => {
      const khalti = new Khalti({ secretKey: 'invalid_key' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => 'Unauthorized Request',
      } as unknown as Response);

      await expect(
        khalti.initiatePayment({
          returnUrl: 'https://example.com/callback',
          websiteUrl: 'https://example.com',
          amount: 1000,
          purchaseOrderId: 'ORD-1',
          purchaseOrderName: 'Order',
        })
      ).rejects.toThrow(KhaltiError);
    });

    it('should throw KhaltiError if response is missing pidx or payment_url', async () => {
      const khalti = new Khalti({ secretKey: 'key123' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ invalid_structure: true }),
      } as unknown as Response);

      await expect(
        khalti.initiatePayment({
          returnUrl: 'https://example.com/callback',
          websiteUrl: 'https://example.com',
          amount: 1000,
          purchaseOrderId: 'ORD-1',
          purchaseOrderName: 'Order',
        })
      ).rejects.toThrow(KhaltiError);
    });

    it('should wrap network exceptions into KhaltiError', async () => {
      const khalti = new Khalti({ secretKey: 'key123' });

      global.fetch = jest.fn().mockRejectedValue(new Error('Connection timed out'));

      await expect(
        khalti.initiatePayment({
          returnUrl: 'https://example.com/callback',
          websiteUrl: 'https://example.com',
          amount: 1000,
          purchaseOrderId: 'ORD-1',
          purchaseOrderName: 'Order',
        })
      ).rejects.toThrow(KhaltiError);
    });
  });

  describe('verifyPayment', () => {
    it('should verify payment successfully when status is Completed', async () => {
      const khalti = new Khalti({ secretKey: 'valid_secret' });

      const mockResponse = {
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
        total_amount: 1000,
        status: 'Completed',
        transaction_id: 'TXN-KHALTI-999',
        fee: 0,
        refunded: false,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await khalti.verifyPayment({
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('Completed');
      expect(result.transactionId).toBe('TXN-KHALTI-999');
      expect(result.totalAmount).toBe(1000);
      expect(result.refunded).toBe(false);
    });

    it('should return success: false when status is Pending or Expired', async () => {
      const khalti = new Khalti({ secretKey: 'valid_secret' });

      const mockResponse = {
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
        total_amount: 1000,
        status: 'Pending',
        transaction_id: null,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await khalti.verifyPayment({
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('Pending');
    });

    it('should throw KhaltiError when lookup API fails', async () => {
      const khalti = new Khalti({ secretKey: 'valid_secret' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'Transaction not found.' }),
      } as unknown as Response);

      await expect(
        khalti.verifyPayment({
          pidx: 'INVALID_PIDX',
        })
      ).rejects.toThrow(KhaltiError);
    });

    it('should wrap network errors in verifyPayment', async () => {
      const khalti = new Khalti({ secretKey: 'valid_secret' });

      global.fetch = jest.fn().mockRejectedValue(new Error('Network reset'));

      await expect(
        khalti.verifyPayment({
          pidx: 'PIDX_NET_ERR',
        })
      ).rejects.toThrow(KhaltiError);
    });

    it('should work with standalone function exports', async () => {
      const mockResponse = {
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
        total_amount: 500,
        status: 'Completed',
        transaction_id: 'TXN-123',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await verifyPayment({
        pidx: 'HT6HuGPEacv2hwLQL8yA2L',
        secretKey: 'key_xyz',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('Completed');

      // Standalone initiate payment
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          pidx: 'STANDALONE_PIDX',
          payment_url: 'https://test-pay.khalti.com/?pidx=STANDALONE_PIDX',
          expires_at: '2026-09-05T18:00:00Z',
          expires_in: 1800,
        }),
      } as unknown as Response);

      const initResult = await initiatePayment({
        returnUrl: 'https://example.com/ret',
        websiteUrl: 'https://example.com',
        amount: 2000,
        purchaseOrderId: 'PO-1',
        purchaseOrderName: 'Product 1',
        secretKey: 'key_xyz',
      });

      expect(initResult.pidx).toBe('STANDALONE_PIDX');
    });
  });
});
