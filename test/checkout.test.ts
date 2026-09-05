import crypto from 'crypto';
import { createCheckout, verifyCallback } from '../src/checkout';
import { ValidationError } from '../src/errors';
import { Esewa, ESEWA_SANDBOX_SECRET_KEY } from '../src/esewa';
import {
  paisaToRupees,
  parseAmount,
  parseBooleanEnv,
  rupeesToPaisa,
} from '../src/utils';

function mockFetchOnce(responses: Array<Partial<Response> & { jsonBody?: unknown; textBody?: string; headersMap?: Record<string, string> }>) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: r.statusText ?? '',
      headers: {
        get: (name: string) => r.headersMap?.[name.toLowerCase()] ?? null,
      },
      json: async () => r.jsonBody,
      text: async () => r.textBody ?? JSON.stringify(r.jsonBody ?? ''),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('Amount utilities', () => {
  it('parseAmount strips thousands separators (eSewa callback quirk)', () => {
    expect(parseAmount('1,000.0')).toBe(1000);
    expect(parseAmount('12,34,567.5')).toBe(1234567.5);
    expect(parseAmount(150)).toBe(150);
    expect(() => parseAmount('not-a-number')).toThrow(ValidationError);
  });

  it('converts between rupees and paisa', () => {
    expect(rupeesToPaisa(10)).toBe(1000);
    expect(rupeesToPaisa('1,500.50')).toBe(150050);
    expect(paisaToRupees(150050)).toBe(1500.5);
    expect(() => paisaToRupees(10.5)).toThrow(ValidationError);
  });

  it('parses boolean env values', () => {
    expect(parseBooleanEnv(undefined)).toBeUndefined();
    expect(parseBooleanEnv('')).toBeUndefined();
    expect(parseBooleanEnv('false')).toBe(false);
    expect(parseBooleanEnv('0')).toBe(false);
    expect(parseBooleanEnv('true')).toBe(true);
    expect(parseBooleanEnv('yes')).toBe(true);
  });
});

describe('Lazy environment resolution', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ESEWA_PRODUCT_CODE;
    delete process.env.ESEWA_SECRET_KEY;
    delete process.env.ESEWA_IS_TEST;
    delete process.env.KHALTI_IS_TEST;
  });

  it('picks up env vars set AFTER the instance was constructed (dotenv pattern)', () => {
    const esewa = new Esewa();
    process.env.ESEWA_PRODUCT_CODE = 'LATE_ENV_CODE';
    process.env.ESEWA_SECRET_KEY = 'late_env_secret';

    const result = esewa.initiatePayment({
      amount: 100,
      transactionUuid: 'txn-late-env',
      successUrl: 'https://example.com/s',
      failureUrl: 'https://example.com/f',
    });
    expect(result.formFields.product_code).toBe('LATE_ENV_CODE');
  });

  it('respects ESEWA_IS_TEST=false from env', () => {
    process.env.ESEWA_IS_TEST = 'false';
    process.env.ESEWA_PRODUCT_CODE = 'PROD_CODE';
    process.env.ESEWA_SECRET_KEY = 'prod_secret';

    const result = new Esewa().initiatePayment({
      amount: 100,
      transactionUuid: 'txn-env-prod',
      successUrl: 'https://example.com/s',
      failureUrl: 'https://example.com/f',
    });
    expect(result.paymentUrl).toContain('https://epay.esewa.com.np');
  });
});

describe('Esewa.createPaymentUrl', () => {
  const originalFetch = global.fetch;
  const esewa = new Esewa({ productCode: 'EPAYTEST', secretKey: 'secret', isTest: true });
  const params = {
    amount: 100,
    transactionUuid: 'txn-redirect',
    successUrl: 'https://example.com/s',
    failureUrl: 'https://example.com/f',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves a redirect URL from the 302 Location header', async () => {
    mockFetchOnce([
      { status: 302, headersMap: { location: '/epay?bookingId=abc123' } },
    ]);
    const result = await esewa.createPaymentUrl(params);
    expect(result.redirectUrl).toBe('https://rc-epay.esewa.com.np/epay?bookingId=abc123');
    expect(result.formFields.transaction_uuid).toBe('txn-redirect');
  });

  it('throws EsewaError when eSewa rejects the payload with a coded error', async () => {
    mockFetchOnce([
      { status: 400, textBody: '{"code":"ES104","message":"Invalid payload signature."}' },
    ]);
    await expect(esewa.createPaymentUrl(params)).rejects.toThrow(/ES104/);
  });

  it('falls back to null redirectUrl on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const result = await esewa.createPaymentUrl(params);
    expect(result.redirectUrl).toBeNull();
    expect(result.formHtml).toContain('esewaPaymentForm');
  });
});

describe('createCheckout', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects non-integer or non-positive amounts', async () => {
    const base = {
      gateway: 'khalti' as const,
      orderId: 'o1',
      orderName: 'Test',
      successUrl: 'https://example.com/cb',
    };
    await expect(createCheckout({ ...base, amount: 10.5 })).rejects.toThrow(/paisa/);
    await expect(createCheckout({ ...base, amount: 0 })).rejects.toThrow(ValidationError);
  });

  it('creates a Khalti session with paisa amount and derived websiteUrl', async () => {
    const fetchMock = mockFetchOnce([
      {
        status: 200,
        jsonBody: {
          pidx: 'PIDX123',
          payment_url: 'https://test-pay.khalti.com/?pidx=PIDX123',
          expires_at: '2026-01-01T00:00:00Z',
          expires_in: 1800,
        },
      },
    ]);

    const session = await createCheckout({
      gateway: 'khalti',
      amount: 150000,
      orderId: 'ORDER-9',
      orderName: 'Premium',
      successUrl: 'https://myshop.com/api/pay/callback/khalti/x',
    }, { esewa: new Esewa(), khalti: new (require('../src/khalti').Khalti)({ secretKey: 'k', isTest: true }) });

    expect(session.sessionId).toBe('PIDX123');
    expect(session.url).toContain('test-pay.khalti.com');
    expect(session.form).toBeNull();

    const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.amount).toBe(150000);
    expect(payload.website_url).toBe('https://myshop.com');
  });

  it('creates an eSewa session converting paisa to NPR, with form fallback', async () => {
    mockFetchOnce([
      { status: 302, headersMap: { location: '/epay?bookingId=xyz' } },
    ]);

    const session = await createCheckout(
      {
        gateway: 'esewa',
        amount: 150050, // Rs 1500.50
        orderId: 'ORDER 10', // needs sanitizing for the uuid
        orderName: 'Premium',
        successUrl: 'https://myshop.com/cb',
      },
      { esewa: new Esewa({ productCode: 'EPAYTEST', secretKey: 's', isTest: true }), khalti: new (require('../src/khalti').Khalti)() }
    );

    expect(session.url).toBe('https://rc-epay.esewa.com.np/epay?bookingId=xyz');
    expect(session.sessionId).toMatch(/^ORDER-10-[0-9a-f]{6}$/);
    expect(session.form?.fields.total_amount).toBe('1500.5');
    expect(session.formHtml).toContain('esewaPaymentForm');
  });
});

describe('verifyCallback', () => {
  const originalFetch = global.fetch;
  const secretKey = ESEWA_SANDBOX_SECRET_KEY;

  function makeEsewaCallback(totalAmount: string) {
    const payload: Record<string, unknown> = {
      transaction_code: '000AWEO',
      status: 'COMPLETE',
      total_amount: totalAmount,
      transaction_uuid: 'txn-cb-1',
      product_code: 'EPAYTEST',
      signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
    };
    const message = String(payload.signed_field_names)
      .split(',')
      .map((f) => `${f}=${payload[f]}`)
      .join(',');
    payload.signature = crypto.createHmac('sha256', secretKey).update(message).digest('base64');
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('verifies an eSewa callback end-to-end, handling comma amounts', async () => {
    const encoded = makeEsewaCallback('1,000.0');
    const fetchMock = mockFetchOnce([
      {
        status: 200,
        jsonBody: { status: 'COMPLETE', ref_id: 'REF1', transaction_uuid: 'txn-cb-1', total_amount: 1000 },
      },
    ]);

    const result = await verifyCallback({ gateway: 'esewa', query: { data: encoded } });

    expect(result.success).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.transactionId).toBe('REF1');
    expect(result.amount).toBe(100000); // paisa
    // status API must be called with the comma stripped
    expect(String(fetchMock.mock.calls[0][0])).toContain('total_amount=1000');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('1%2C000');
  });

  it('short-circuits with success:false when the eSewa signature is invalid', async () => {
    const encoded = makeEsewaCallback('500');
    const tampered = Buffer.from(
      Buffer.from(encoded, 'base64').toString('utf8').replace('"500"', '"9999"')
    ).toString('base64');
    const fetchMock = mockFetchOnce([]);

    const result = await verifyCallback({ gateway: 'esewa', query: { data: tampered } });
    expect(result.success).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('decodes callback data whose + chars became spaces via query parsing', async () => {
    const encoded = makeEsewaCallback('1,000.0');
    const spaced = encoded.replace(/\+/g, ' ');
    mockFetchOnce([
      { status: 200, jsonBody: { status: 'COMPLETE', ref_id: 'REF2' } },
    ]);
    const result = await verifyCallback({ gateway: 'esewa', query: { data: spaced } });
    expect(result.signatureValid).toBe(true);
  });

  it('verifies a Khalti callback via the lookup API', async () => {
    mockFetchOnce([
      {
        status: 200,
        jsonBody: { pidx: 'PIDX9', status: 'Completed', transaction_id: 'TID1', total_amount: 150000 },
      },
    ]);
    const result = await verifyCallback(
      { gateway: 'khalti', query: { pidx: 'PIDX9', status: 'Completed' } },
      { esewa: new Esewa(), khalti: new (require('../src/khalti').Khalti)({ secretKey: 'k' }) }
    );
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('PIDX9');
    expect(result.transactionId).toBe('TID1');
    expect(result.amount).toBe(150000);
  });

  it('throws ValidationError when required callback params are missing', async () => {
    await expect(verifyCallback({ gateway: 'esewa', query: {} })).rejects.toThrow(/data/);
    await expect(verifyCallback({ gateway: 'khalti', query: {} })).rejects.toThrow(/pidx/);
  });
});
