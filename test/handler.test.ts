import crypto from 'crypto';
import { ValidationError } from '../src/errors';
import { ESEWA_SANDBOX_SECRET_KEY } from '../src/esewa';
import { CallbackResult, createCheckoutHandler } from '../src/handler';

function mockFetchQueue(
  responses: Array<{ status?: number; jsonBody?: unknown; textBody?: string; headersMap?: Record<string, string> }>
) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: '',
      headers: { get: (name: string) => r.headersMap?.[name.toLowerCase()] ?? null },
      json: async () => r.jsonBody,
      text: async () => r.textBody ?? JSON.stringify(r.jsonBody ?? ''),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('createCheckoutHandler', () => {
  const originalFetch = global.fetch;

  const baseConfig = {
    esewa: { productCode: 'EPAYTEST', secretKey: ESEWA_SANDBOX_SECRET_KEY, isTest: true },
    khalti: { secretKey: 'khalti-test-key', isTest: true },
    resolveOrder: jest.fn(async ({ orderId }: { orderId: string }) => ({
      amount: 150000,
      orderName: `Order ${orderId}`,
    })),
    successRedirect: '/payment/success',
    failureRedirect: '/payment/failed',
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('requires resolveOrder and redirect URLs', () => {
    expect(() => createCheckoutHandler({} as never)).toThrow(ValidationError);
    expect(() =>
      createCheckoutHandler({ ...baseConfig, successRedirect: '' } as never)
    ).toThrow(ValidationError);
  });

  it('creates a Khalti checkout session via POST /checkout', async () => {
    const fetchMock = mockFetchQueue([
      {
        status: 200,
        jsonBody: { pidx: 'PIDX1', payment_url: 'https://test-pay.khalti.com/?pidx=PIDX1', expires_at: '', expires_in: 1800 },
      },
    ]);
    const handler = createCheckoutHandler(baseConfig);

    const response = await handler.handleRequest(
      new Request('https://myshop.com/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'khalti', orderId: 'ORDER-1' }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toContain('test-pay.khalti.com');
    expect(body.sessionId).toBe('PIDX1');
    expect(body.amount).toBe(150000); // from resolveOrder, not the client

    // return_url must point back at the handler's own callback route
    const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.return_url).toMatch(
      /^https:\/\/myshop\.com\/api\/pay\/callback\/khalti\/[A-Za-z0-9_-]+$/
    );
    expect(payload.amount).toBe(150000);
    expect(baseConfig.resolveOrder).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'khalti', orderId: 'ORDER-1' })
    );
  });

  it('creates an eSewa checkout session with redirect URL', async () => {
    mockFetchQueue([{ status: 302, headersMap: { location: '/epay?bookingId=b1' } }]);
    const handler = createCheckoutHandler(baseConfig);

    const response = await handler.handleRequest(
      new Request('https://myshop.com/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'esewa', orderId: 'ORDER-2' }),
      })
    );

    const body = await response.json();
    expect(body.url).toBe('https://rc-epay.esewa.com.np/epay?bookingId=b1');
    expect(body.form.action).toContain('/api/epay/main/v2/form');
    expect(body.form.fields.total_amount).toBe('1500');
  });

  it('rejects bad checkout requests', async () => {
    const handler = createCheckoutHandler(baseConfig);
    const bad = await handler.handleRequest(
      new Request('https://myshop.com/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'paypal', orderId: 'x' }),
      })
    );
    expect(bad.status).toBe(400);

    const noOrder = await handler.handleRequest(
      new Request('https://myshop.com/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'khalti' }),
      })
    );
    expect(noOrder.status).toBe(400);
  });

  it('handles a successful Khalti callback: verifies, fires onSuccess, redirects', async () => {
    mockFetchQueue([
      {
        status: 200,
        jsonBody: { pidx: 'PIDX1', status: 'Completed', transaction_id: 'T1', total_amount: 150000 },
      },
    ]);
    const onSuccess = jest.fn();
    const handler = createCheckoutHandler({ ...baseConfig, onSuccess });

    const orderSeg = Buffer.from('ORDER-1').toString('base64url');
    const response = await handler.handleRequest(
      new Request(`https://myshop.com/api/pay/callback/khalti/${orderSeg}?pidx=PIDX1&status=Completed`)
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location).toContain('/payment/success');
    expect(location).toContain('orderId=ORDER-1');
    expect(location).toContain('sessionId=PIDX1');
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ORDER-1', success: true, transactionId: 'T1' })
    );
  });

  it('handles a verified eSewa callback', async () => {
    const payload: Record<string, unknown> = {
      transaction_code: 'C1',
      status: 'COMPLETE',
      total_amount: '1,500.0',
      transaction_uuid: 'ORDER-2-abc123',
      product_code: 'EPAYTEST',
      signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
    };
    const message = String(payload.signed_field_names)
      .split(',')
      .map((f) => `${f}=${payload[f]}`)
      .join(',');
    payload.signature = crypto
      .createHmac('sha256', ESEWA_SANDBOX_SECRET_KEY)
      .update(message)
      .digest('base64');
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');

    mockFetchQueue([
      { status: 200, jsonBody: { status: 'COMPLETE', ref_id: 'REF9' } },
    ]);
    const onSuccess = jest.fn();
    const handler = createCheckoutHandler({ ...baseConfig, onSuccess });

    const orderSeg = Buffer.from('ORDER-2').toString('base64url');
    const response = await handler.handleRequest(
      new Request(
        `https://myshop.com/api/pay/callback/esewa/${orderSeg}?data=${encodeURIComponent(data)}`
      )
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/payment/success');
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ORDER-2', success: true, transactionId: 'REF9' })
    );
  });

  it('treats an eSewa callback without data as a failure and fires onFailure', async () => {
    const onFailure = jest.fn();
    const handler = createCheckoutHandler({ ...baseConfig, onFailure });

    const orderSeg = Buffer.from('ORDER-3').toString('base64url');
    const response = await handler.handleRequest(
      new Request(`https://myshop.com/api/pay/callback/esewa/${orderSeg}`)
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/payment/failed');
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ORDER-3', success: false })
    );
  });

  it('redirects to failureRedirect when Khalti lookup says not completed', async () => {
    mockFetchQueue([
      { status: 200, jsonBody: { pidx: 'PIDX2', status: 'User canceled', total_amount: 150000 } },
    ]);
    const onFailure = jest.fn((p: CallbackResult) => {
      expect(p.status).toBe('User canceled');
    });
    const handler = createCheckoutHandler({ ...baseConfig, onFailure });

    const orderSeg = Buffer.from('ORDER-4').toString('base64url');
    const response = await handler.handleRequest(
      new Request(`https://myshop.com/api/pay/callback/khalti/${orderSeg}?pidx=PIDX2`)
    );

    expect(response.headers.get('location')).toContain('/payment/failed');
    expect(onFailure).toHaveBeenCalled();
  });

  it('respects an explicit origin override for callback URLs', async () => {
    const fetchMock = mockFetchQueue([
      { status: 200, jsonBody: { pidx: 'P', payment_url: 'https://x', expires_at: '', expires_in: 1 } },
    ]);
    const handler = createCheckoutHandler({ ...baseConfig, origin: 'https://public.example.com' });

    await handler.handleRequest(
      new Request('http://localhost:3000/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'khalti', orderId: 'O' }),
      })
    );

    const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.return_url).toContain('https://public.example.com/api/pay/callback/khalti/');
  });

  it('returns 404 for unknown routes', async () => {
    const handler = createCheckoutHandler(baseConfig);
    const response = await handler.handleRequest(new Request('https://myshop.com/api/pay/nope'));
    expect(response.status).toBe(404);
  });

  describe('custom route segments', () => {
    it('honors renamed checkout and callback segments end-to-end', async () => {
      const fetchMock = mockFetchQueue([
        {
          status: 200,
          jsonBody: { pidx: 'P1', payment_url: 'https://test-pay.khalti.com/?pidx=P1', expires_at: '', expires_in: 1800 },
        },
        {
          status: 200,
          jsonBody: { pidx: 'P1', status: 'Completed', transaction_id: 'T1', total_amount: 150000 },
        },
      ]);
      const onSuccess = jest.fn();
      const handler = createCheckoutHandler({
        ...baseConfig,
        onSuccess,
        routes: { checkout: 'create-session', callback: 'gateway-return' },
      });

      // old default route must now 404
      const old = await handler.handleRequest(
        new Request('https://myshop.com/api/pay/checkout', {
          method: 'POST',
          body: JSON.stringify({ gateway: 'khalti', orderId: 'R-1' }),
        })
      );
      expect(old.status).toBe(404);

      // renamed checkout route works, and callback URL uses the renamed segment
      const created = await handler.handleRequest(
        new Request('https://myshop.com/api/pay/create-session', {
          method: 'POST',
          body: JSON.stringify({ gateway: 'khalti', orderId: 'R-1' }),
        })
      );
      expect(created.status).toBe(200);
      const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.return_url).toContain('/api/pay/gateway-return/khalti/');

      // renamed callback route verifies as usual
      const orderSeg = Buffer.from('R-1').toString('base64url');
      const cb = await handler.handleRequest(
        new Request(`https://myshop.com/api/pay/gateway-return/khalti/${orderSeg}?pidx=P1`)
      );
      expect(cb.status).toBe(303);
      expect(onSuccess).toHaveBeenCalled();
    });

    it('rejects multi-segment route overrides', () => {
      expect(() =>
        createCheckoutHandler({ ...baseConfig, routes: { checkout: 'a/b' } })
      ).toThrow(ValidationError);
    });

    it('exposes callbackPath for externally created sessions', () => {
      const handler = createCheckoutHandler(baseConfig);
      expect(handler.callbackPath('khalti', 'ORDER-1')).toBe(
        `/callback/khalti/${Buffer.from('ORDER-1').toString('base64url')}`
      );

      const renamed = createCheckoutHandler({ ...baseConfig, routes: { callback: 'ipn' } });
      expect(renamed.callbackPath('esewa', 'O2')).toMatch(/^\/ipn\/esewa\//);
    });
  });
});
