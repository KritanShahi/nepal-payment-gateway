import { createExpressCheckoutHandler, ExpressLikeRequest, ExpressLikeResponse } from '../src/express';
import { createNextCheckoutHandlers } from '../src/next';

function mockFetchQueue(responses: Array<{ status?: number; jsonBody?: unknown }>) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: '',
      headers: { get: () => null },
      json: async () => r.jsonBody,
      text: async () => JSON.stringify(r.jsonBody ?? ''),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const baseConfig = {
  esewa: { productCode: 'EPAYTEST', secretKey: 'secret', isTest: true },
  khalti: { secretKey: 'khalti-key', isTest: true },
  resolveOrder: async () => ({ amount: 100000, orderName: 'Test order' }),
  successRedirect: '/ok',
  failureRedirect: '/fail',
};

const khaltiInitiateResponse = {
  status: 200,
  jsonBody: { pidx: 'P1', payment_url: 'https://test-pay.khalti.com/?pidx=P1', expires_at: '', expires_in: 1800 },
};

describe('createNextCheckoutHandlers', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns GET and POST handlers that route to the shared handler', async () => {
    mockFetchQueue([khaltiInitiateResponse]);
    const { GET, POST } = createNextCheckoutHandlers(baseConfig);
    expect(typeof GET).toBe('function');

    const response = await POST(
      new Request('https://myshop.com/api/pay/checkout', {
        method: 'POST',
        body: JSON.stringify({ gateway: 'khalti', orderId: 'N-1' }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessionId).toBe('P1');

    const notFound = await GET(new Request('https://myshop.com/api/pay/unknown'));
    expect(notFound.status).toBe(404);
  });
});

describe('createExpressCheckoutHandler', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeRes() {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: undefined as string | undefined,
      ended: false,
      status(code: number) {
        res.statusCode = code;
        return res as unknown as ExpressLikeResponse;
      },
      setHeader(name: string, value: string) {
        res.headers[name.toLowerCase()] = value;
      },
      send(body: string) {
        res.body = body;
      },
      end() {
        res.ended = true;
      },
    };
    return res;
  }

  it('handles a checkout POST with express.json() pre-parsed body', async () => {
    mockFetchQueue([khaltiInitiateResponse]);
    const middleware = createExpressCheckoutHandler(baseConfig);
    const res = makeRes();

    await middleware(
      {
        method: 'POST',
        originalUrl: '/api/pay/checkout',
        protocol: 'https',
        headers: { host: 'myshop.com', 'content-type': 'application/json' },
        body: { gateway: 'khalti', orderId: 'E-1' },
      } as ExpressLikeRequest,
      res as unknown as ExpressLikeResponse
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).sessionId).toBe('P1');
  });

  it('reads a raw stream body when no body parser ran', async () => {
    mockFetchQueue([khaltiInitiateResponse]);
    const middleware = createExpressCheckoutHandler(baseConfig);
    const res = makeRes();

    const rawBody = Buffer.from(JSON.stringify({ gateway: 'khalti', orderId: 'E-2' }));
    const req: ExpressLikeRequest = {
      method: 'POST',
      originalUrl: '/api/pay/checkout',
      protocol: 'https',
      headers: { host: 'myshop.com' },
      async *[Symbol.asyncIterator]() {
        yield rawBody;
      },
    };

    await middleware(req, res as unknown as ExpressLikeResponse);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).orderId).toBe('E-2');
  });

  it('respects x-forwarded headers and dispatches callback redirects', async () => {
    mockFetchQueue([
      { status: 200, jsonBody: { pidx: 'P2', status: 'Completed', transaction_id: 'T2', total_amount: 100000 } },
    ]);
    const onSuccess = jest.fn();
    const middleware = createExpressCheckoutHandler({ ...baseConfig, onSuccess });
    const res = makeRes();

    const orderSeg = Buffer.from('E-3').toString('base64url');
    await middleware(
      {
        method: 'GET',
        originalUrl: `/api/pay/callback/khalti/${orderSeg}?pidx=P2`,
        protocol: 'http',
        headers: { host: 'internal:3000', 'x-forwarded-host': 'myshop.com', 'x-forwarded-proto': 'https' },
      } as ExpressLikeRequest,
      res as unknown as ExpressLikeResponse
    );

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain('/ok');
    expect(res.headers.location).toContain('orderId=E-3');
    expect(res.ended).toBe(true);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('forwards unexpected errors to next()', async () => {
    const middleware = createExpressCheckoutHandler(baseConfig);
    const next = jest.fn();
    // Missing headers object access will throw inside the adapter
    await middleware(null as unknown as ExpressLikeRequest, makeRes() as unknown as ExpressLikeResponse, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
